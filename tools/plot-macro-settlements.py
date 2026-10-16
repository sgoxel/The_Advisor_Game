"""Plot full canonical registries against the same coarse mainland sample."""
import json,sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
old,new=[json.loads(Path(p).read_text(encoding='utf-8')) for p in sys.argv[1:3]]
fig,axs=plt.subplots(2,3,figsize=(17,9),facecolor='#f1ecdc',layout='constrained')
for row,data in enumerate([old,new]):
 for col in range(3):
  centre=data['continents'][col]['canonicalPosition']['lon']*180/3.141592653589793
  unwrap=lambda lon: centre+(lon-centre+180)%360-180
  ax=axs[row,col];ax.set_facecolor('#dbe4e5');land=[p for p in data['points'] if p['continent']==col]
  ax.scatter([unwrap(p['lon']) for p in land],[p['lat'] for p in land],c=[int(p['country'].split('/')[-1]) for p in land],cmap='terrain',s=15,alpha=.5,linewidths=0)
  for kind,marker,size,color in [('villages','.',7,'#28553c'),('cities','^',26,'#b65e17')]:
   records=[p for p in data[kind] if p['continent']==col]
   ax.scatter([unwrap(p['canonicalPosition']['lon']*180/3.141592653589793) for p in records],[p['canonicalPosition']['lat']*180/3.141592653589793 for p in records],s=size,c=color,marker=marker,label=kind,linewidths=.2)
  ax.set_xlim(min(unwrap(p['lon']) for p in land)-2,max(unwrap(p['lon']) for p in land)+2);ax.set_ylim(min(p['lat'] for p in land)-2,max(p['lat'] for p in land)+2)
  ax.set_title(('Before' if row==0 else 'Candidate')+' — '+data['continents'][col]['name']);ax.set_xlabel('Longitude');ax.set_ylabel('Latitude');ax.legend(loc='lower left',fontsize=8)
fig.suptitle('Canonical macro distribution — unchanged continents/countries\nBefore:108 cities /324 villages; candidate:'+str(new['counts']['cities'])+' cities /'+str(new['counts']['villages'])+' villages. Coarse mainland sample, not fine scenery.',fontsize=14)
fig.savefig(sys.argv[3],dpi=140)
