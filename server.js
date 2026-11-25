const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {generateQrSvg}=require('./qr_svg');
const port=Number(process.env.PORT||3000);
if(!process.env.HOST_KEY||process.env.HOST_KEY.length<16){console.error('Define HOST_KEY (mínimo 16 caracteres) antes de iniciar.');process.exit(1);}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
(async()=>{
const {initialState,handleGame}=await import('./game.mjs');
const state=initialState();let queue=Promise.resolve();
const lan=Object.values(os.networkInterfaces()).flat().find(n=>n&&n.family==='IPv4'&&!n.internal)?.address||'127.0.0.1';
const server=http.createServer(async(req,res)=>{
const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
try{
const url=new URL(req.url,`http://${req.headers.host||'localhost:'+port}`);const origin=process.env.PUBLIC_ORIGIN||`http://${lan}:${port}`;
if(url.pathname==='/api/qr.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});return res.end(generateQrSvg(new URL('/play',origin).href,'#000000','#FFF8DC'));}
if(url.pathname.startsWith('/api/')){
let body={};if(req.method==='POST'){if(req.headers.origin&&req.headers.origin!==url.origin)return send(403,{error:'Origen inválido'});let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)return send(413,{error:'Solicitud demasiado grande'});}try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return send(400,{error:'JSON inválido'});}}
const p=queue.then(()=>handleGame(state,{method:req.method,path:url.pathname,origin,auth:req.headers['x-host-key'],body},process.env.HOST_KEY));queue=p.catch(()=>{});const result=await p;return send(result.status,result.data);}
const pathname=({'/':'/index.html','/host':'/index.html','/play':'/play.html','/mobile':'/play.html'})[url.pathname]||url.pathname;
const root=path.resolve(__dirname,'public'),file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(404,{error:'Ruta no encontrada'});res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}catch(e){console.error(e);if(!res.headersSent)send(500,{error:'Error interno'});else res.end();}
});server.listen(port,'0.0.0.0',()=>console.log(`http://localhost:${port}/`));
})();
