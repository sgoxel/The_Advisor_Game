"""Stable-ground CIELAB DeltaE76 and new block-edge gate for adjacent zoom frames.

Pairs retain focus and differ by 0.2% in scale. UI/props are excluded at capture;
the right-centre crop avoids the phone sidebar, compass and coordinate badge.
An 8px box filter permits small geometry/detail motion. DeltaE76 is a perceptual
Lab metric: mean <=2, p95 <=5 and no newly strengthened tile/block edge >3 Lab
units. Sparse moving vector contours are measured by crop area so a few dashed
border/road pixels cannot dominate the ratio; unmatched contour area must stay
below 0.5% of the crop. The historical green->pale-green replacement is tens of
Lab units.
"""
import json,sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

def lab(rgb):
    c=rgb/255.0
    linear=np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
    xyz=linear @ np.array([[.4124564,.2126729,.0193339],[.3575761,.7151522,.1191920],[.1804375,.0721750,.9503041]])
    xyz=xyz/np.array([.95047,1,1.08883])
    f=np.where(xyz>(6/29)**3,np.cbrt(xyz),xyz/(3*(6/29)**2)+4/29)
    return np.stack([116*f[...,1]-16,500*(f[...,0]-f[...,1]),200*(f[...,1]-f[...,2])],axis=-1)

def ground(file):
    image=Image.open(file).convert('RGB')
    w,h=image.size
    image=image.crop((int(w*.55),int(h*.25),int(w*.82),int(h*.59))).filter(ImageFilter.BoxBlur(4))
    return lab(np.asarray(image,dtype=float))

def edges(a):
    return max(float(np.percentile(np.linalg.norm(np.diff(a,axis=axis),axis=2),99)) for axis in [0,1])

def contour(a):
    mask=np.zeros(a.shape[:2],dtype=bool)
    for axis in [0,1]:
        strong=np.linalg.norm(np.diff(a,axis=axis),axis=2)>2
        if axis==0: mask[:-1]|=strong; mask[1:]|=strong
        else: mask[:,:-1]|=strong; mask[:,1:]|=strong
    return mask

def expand(mask):
    return np.asarray(Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(17)))>0

if sys.argv[1:] == ['--self-test']:
    rich=lab(np.full((40,40,3),[55,88,66],dtype=float))
    pale=lab(np.full((40,40,3),[155,168,125],dtype=float))
    delta=float(np.linalg.norm(rich-pale,axis=2).mean())
    blocks=rich.copy(); blocks[:,20:]=pale[:,20:]
    assert delta>20 and edges(blocks)-edges(rich)>3
    print(json.dumps({'historicalPaletteFixtureDeltaE76':delta,'newBlockEdge':edges(blocks),'rejected':True}))
    sys.exit(0)

results=[]
for file in sys.argv[1:]:
    for pair in json.loads(Path(file).read_text()):
        def retained_image(frame):
            path=Path(frame['file'])
            retained=Path(file).parent/path.name
            return retained if retained.exists() else path
        a,b=ground(retained_image(pair['before'])),ground(retained_image(pair['after']))
        d=np.linalg.norm(a-b,axis=2)
        ca,cb=contour(a),contour(b)
        near_a,near_b=expand(ca),expand(cb)
        # Existing shore/relief/vector contours are changing geometry, not stable
        # ground. Mask their pre-existing neighbourhood for the color gate. Measure
        # unmatched contours against the full crop area instead of the (sometimes
        # tiny) contour population, so sparse dashed borders cannot turn a handful
        # of moved pixels into a large percentage. Broad/new seams still fail this
        # area gate and the independent new-edge-contrast gate.
        stable=~near_a
        if stable.mean()<0.4: raise ValueError('Too little stable ground in fixture')
        mismatch=max(float((cb&~near_a).mean()),float((ca&~near_b).mean()))
        result={'fixture':pair['fixture'],'height':pair['before']['height'],'meanDeltaE76':float(d[stable].mean()),'p95DeltaE76':float(np.percentile(d[stable],95)),'stableGroundFraction':float(stable.mean()),'contourMismatchFraction':mismatch,'newEdgeContrast':float(max(0,edges(b)-edges(a)))}
        result['passed']=result['meanDeltaE76']<=2 and result['p95DeltaE76']<=5 and result['newEdgeContrast']<=3 and mismatch<=0.005
        results.append(result)
Path('test-results/zoom-metrics.json').write_text(json.dumps(results,indent=2))
failed=[r for r in results if not r['passed']]
print(json.dumps({'pairs':len(results),'failed':failed,'worstMean':max(r['meanDeltaE76'] for r in results)},indent=2))
if failed: sys.exit(1)
