import type * as pc from 'playcanvas';
export type ClipEntry={id:string;name:string;url:string;duration:number;loop:boolean;bones:number;sourceFile:string;sourceSha256:string};
export type Pack={version:number;name:string;clips:ClipEntry[];defaults:{idle:string;walk:string;run:string}};
export type PackController={pack:Pack;supported:boolean;select(id:string):Promise<void>;locomotion(speed:number):Promise<void>;automatic():void;pause(value:boolean):void;speed(value:number):void;inPlace(value:boolean):Promise<void>;reset():Promise<void>;snapshot():any;destroy():void};
export function loadPack(base?:string):Promise<Pack>;
export function attachPack(engine:typeof pc,app:pc.AppBase,model:pc.Entity,options?:{base?:string;inPlace?:boolean;onStatus?:(message:string)=>void}):Promise<PackController|null>;
