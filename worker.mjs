import { initialState, handleGame } from './game.mjs';
import { generateQrSvg } from './qr.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const roomId=url=>url.searchParams.get('room')||'';
const validRoom=room=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(room);
const joinUrl=url=>{const u=new URL('/play',url);u.searchParams.set('room',roomId(url));return u.href;};
export class CiacpartyGame {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(req){
    const url=new URL(req.url);
    let body={};
    if(req.method==='POST'){
      if(req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)return json({error:'Origen inválido'},403);
      try{const raw=await req.text();if(raw.length>100000)return json({error:'Solicitud demasiado grande'},413);body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({error:'JSON inválido'},400);}
    }
    return this.ctx.blockConcurrencyWhile(async()=>{
      const supplied=req.headers.get('X-Host-Key');
      let host=await this.ctx.storage.get('host');
      if(url.pathname==='/api/host/session'&&req.method==='POST'){
        if(typeof supplied!=='string'||!/^[a-f0-9-]{72}$/i.test(supplied))return json({error:'Sesión inválida'},400);
        if(host&&host!==supplied)return json({error:'Sala ocupada'},403);
        if(!host){
          const bank=typeof this.env.QUESTION_BANK==='string'?JSON.parse(this.env.QUESTION_BANK):this.env.QUESTION_BANK;
          if(!Array.isArray(bank)||bank.length!==10)return json({error:'Banco no disponible'},503);
          await this.ctx.storage.put({host:supplied,game:initialState(bank)});
        }
        return json({ok:true});
      }
      if(!host)return json({error:'Escanea el QR de una partida activa'},404);
      // Las claves de respuesta y las ediciones del banco no se ofrecen al público.
      if(url.pathname==='/api/questions'||body.action==='LOAD_QUESTIONS')return json({error:'Banco administrado en el servidor'},403);
      const state=await this.ctx.storage.get('game');
      if(!state)return json({error:'Partida no disponible'},404);
      const result=await handleGame(state,{method:req.method,path:url.pathname,origin:url.origin,auth:supplied,body},host);
      if(result.changed)await this.ctx.storage.put('game',state);
      if(result.data?.joinUrl)result.data.joinUrl=joinUrl(url);
      if(result.data?.state?.joinUrl)result.data.state.joinUrl=joinUrl(url);
      return json(result.data,result.status);
    });
  }
}
export default {async fetch(req,env){
  const url=new URL(req.url);
  if(url.pathname.startsWith('/api/')){
    const room=roomId(url);
    if(!validRoom(room))return json({error:'Escanea el QR de la partida'},400);
    if(url.pathname==='/api/qr.svg')return new Response(generateQrSvg(joinUrl(url),'#000000','#FFF8DC'),{headers:{'Content-Type':'image/svg+xml','Cache-Control':'no-store'}});
    return env.CIACPARTY_GAME.get(env.CIACPARTY_GAME.idFromName(room)).fetch(req);
  }
  if(url.pathname==='/play'||url.pathname==='/mobile')return env.ASSETS.fetch(new Request(new URL('/play.html',url),req));
  if(url.pathname==='/host')return env.ASSETS.fetch(new Request(new URL('/index.html',url),req));
  return env.ASSETS.fetch(req);
}};
