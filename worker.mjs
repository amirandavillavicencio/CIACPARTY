import { initialState, handleGame } from './game.mjs';
import { generateQrSvg } from './qr.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export class CiacpartyGame {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(req){
    const url=new URL(req.url);
    let body={};
    if(req.method==='POST'){
      if(req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)return json({error:'Origen inválido'},403);
      try{const raw=await req.text();if(raw.length>100000)return json({error:'Solicitud demasiado grande'},413);body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({error:'JSON inválido'},400);}
    }
    // Serializa lectura, modificación y persistencia de cada petición.
    return this.ctx.blockConcurrencyWhile(async()=>{
      const state=await this.ctx.storage.get('game')||initialState();
      const result=await handleGame(state,{method:req.method,path:url.pathname,origin:url.origin,auth:req.headers.get('X-Host-Key'),body},this.env.HOST_KEY);
      if(result.changed)await this.ctx.storage.put('game',state);
      return json(result.data,result.status);
    });
  }
}
export default {async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname==='/api/qr.svg')return new Response(generateQrSvg(new URL('/play',url).href,'#000000','#FFF8DC'),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}});
  if(url.pathname.startsWith('/api/'))return env.CIACPARTY_GAME.get(env.CIACPARTY_GAME.idFromName('ciacparty')).fetch(req);
  if(url.pathname==='/play'||url.pathname==='/mobile')return env.ASSETS.fetch(new Request(new URL('/play.html',url),req));
  if(url.pathname==='/host')return env.ASSETS.fetch(new Request(new URL('/index.html',url),req));
  return env.ASSETS.fetch(req);
}};
