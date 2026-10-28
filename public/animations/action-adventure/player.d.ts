import type * as pc from 'playcanvas';
export type ClipEntry={id:string;name:string;url:string;duration:number;loop:boolean;bones:number;sourceFile:string;sourceSha256:string;sourceProfile?:string};
export type Pack={version:number;name:string;profile?:string;clips:ClipEntry[];defaults:{idle:string;walk:string;run:string}};
export type PackController={pack:Pack;supported:boolean;select(id:string):Promise<void>;locomotion(speed:number):Promise<void>;automatic():void;pause(value:boolean):void;speed(value:number):void;inPlace(value:boolean):Promise<void>;reset():Promise<void>;snapshot():any;destroy():void};
export function animationProfile(character?:string|{animationProfile?:string;animation_profile?:string;export?:{animationProfile?:string};height_preset?:string;name?:string;key?:string}):string;
export function loadPack(base?:string,profile?:string):Promise<Pack>;
export function attachPack(engine:typeof pc,app:pc.AppBase,model:pc.Entity,options?:{base?:string;inPlace?:boolean;onStatus?:(message:string)=>void;profile?:string}):Promise<PackController|null>;
