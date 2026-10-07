/** The only wall-clock boundary. All gameplay consumes the resulting fantasy tick. */
export const REAL_EPOCH_MS=Date.parse('2026-10-07T08:48:29Z');
export const TIME_SCALE=24;
export const YEAR_OFFSET=1900;
export const WORLD_TIMEZONE='Europe/Istanbul';
export function fantasyOrigin(realMs:number):number{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:WORLD_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(realMs);
  const n=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  const date=new Date(0);date.setUTCFullYear(n('year')-YEAR_OFFSET,n('month')-1,n('day'));date.setUTCHours(n('hour'),n('minute'),n('second'),0);
  return date.getTime();
}
export class FantasyClock{
  readonly origin:number;
  readonly epoch:number;
  constructor(epoch=REAL_EPOCH_MS){this.epoch=epoch;this.origin=fantasyOrigin(epoch);}
  tickAt(realMs:number):number{return Math.max(0,Math.floor((realMs-this.epoch)/1000*TIME_SCALE));}
  dateAt(realMs:number):Date{return new Date(this.origin+this.tickAt(realMs)*1000);}
  labelAt(realMs:number):string{
    const d=this.dateAt(realMs),pad=(n:number,width=2)=>String(n).padStart(width,'0');
    return`${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${pad(d.getUTCFullYear(),4)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
}
