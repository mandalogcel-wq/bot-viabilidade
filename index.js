// ============================================================
// BOT-VIABILIDADE — Mandalog
// Servico gerador de imagem PNG de estudo financeiro
// POST /gerar  -> PNG base64 + URL temporaria
// GET  /card/:id -> PNG direto (para sendImage Z-API)
// GET  /card-base/:perfil -> card base pre-calculado
// GET  /health -> status
// ============================================================

const express = require('express');
const sharp   = require('sharp');
const crypto  = require('crypto');
const app     = express();
const PORT    = process.env.PORT || 3000;
app.use(express.json());

const cache = new Map();
const TTL   = 30 * 60 * 1000;
setInterval(() => { const now=Date.now(); for(const[k,v]of cache)if(now-v.ts>TTL)cache.delete(k); }, 5*60*1000);

const DIESEL=6.40,GASOLINA=5.80,PED_EIXO=76.48,FRETE_SUPLEY=2421.60;
const PED_VOLTA_3AX=PED_EIXO*3;
const TAB_VAN=[[1,4,400],[5,8,450],[9,12,500],[13,16,560],[17,20,600],[21,99,655]];
function freteVAN(n){let r=0;for(let i=1;i<=n;i++){const f=TAB_VAN.find(t=>i>=t[0]&&i<=t[1]);r+=f?f[2]:655;}return r;}
const FAIXAS_VUC={'1A':550,'1B':590,'1C':610,'2':655,'3':715,'4':815,'5':865};
const VUC_MEDIA_PAD=((550+590+610)/3)*0.60+655*0.30+715*0.10;

function calcular(p){
  const M=v=>'R$ '+Math.round(v).toLocaleString('pt-BR');
  if(p.operacao==='supley'){
    const q=p.viagens||20,cl=p.consumo_c||3.2,ce=p.consumo_v||5.0,km=264;
    const receita=FRETE_SUPLEY*q;
    const litros=(km/cl+km/ce)*q;
    const comb=litros*(p.diesel||DIESEL);
    const ped=PED_VOLTA_3AX*q;
    const loc=(p.loc_vg||0)*q;
    const manut=p.manut||(p.cavalo?1800:2800);
    const seguro=p.seguro||(p.cavalo?900:1200);
    const deprec=p.deprec||(p.cavalo?1000:1500);
    const outros=p.outros||300;
    const custos=comb+ped+loc+manut+seguro+deprec+outros;
    const liq=receita-custos;
    const marg=liq/receita*100;
    return{receita,comb,ped,loc,manut,seguro,deprec,outros,custos,liq,marg,q,km:km*2*q,
      rows:[
        {l:'Combustivel - ida '+cl+' km/l / volta '+ce+' km/l',v:comb},
        {l:'Pedagio retorno (3 eixos x '+q+' viagens)',v:ped},
        ...(loc>0?[{l:'Locacao carreta (R$250 x '+q+' viagens)',v:loc}]:[]),
        {l:'Manutencao',v:manut},{l:'Seguro',v:seguro},
        {l:'Reserva / pneus / imprevistos',v:deprec},
        {l:'Outros (alimentacao, etc.)',v:outros}
      ]};
  } else {
    const q=p.saidas||20,km=p.km_saida||85;
    const cpreco=p.combustivel_preco||(p.diesel_flag?DIESEL:GASOLINA);
    const cons=p.consumo||(p.vuc?10:8);
    let receita,frete_unit_label;
    if(p.vuc){
      const fv=p.faixa?(FAIXAS_VUC[p.faixa]||VUC_MEDIA_PAD):VUC_MEDIA_PAD;
      receita=fv*q; frete_unit_label='R$'+Math.round(fv)+'/saida (faixa '+(p.faixa||'1+2 pond.')+')';
    } else {
      receita=freteVAN(q); frete_unit_label='frete medio R$'+Math.round(receita/q)+'/saida';
    }
    const comb=(km*q/cons)*cpreco;
    const manut=p.manut||(p.vuc?900:700);
    const seguro=p.seguro||(p.vuc?400:350);
    const deprec=p.deprec||(p.vuc?500:(p.terceiro?0:400));
    const loc=p.terceiro?(p.loc_mes||(p.vuc?0:(p.hr?1900:2200))):0;
    const outros=p.outros||200;
    const custos=comb+manut+seguro+deprec+loc+outros;
    const liq=receita-custos,marg=liq/receita*100;
    return{receita,comb,manut,seguro,deprec,loc,outros,custos,liq,marg,q,km:km*q,frete_unit_label,
      rows:[
        {l:'Combustivel - '+km*q+' km ('+(p.diesel_flag?'diesel':'gasolina')+', '+cons+' km/l)',v:comb},
        ...(loc>0?[{l:'Repasse ao dono do veiculo',v:loc}]:[]),
        {l:'Manutencao',v:manut},{l:'Seguro',v:seguro},
        ...(deprec>0?[{l:'Reserva / pneus / imprevistos',v:deprec}]:[]),
        {l:'Outros (alimentacao, etc.)',v:outros}
      ]};
  }
}

function gerarSVG(p,r){
  const W=1080,H=1350;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const M=v=>'R$ '+Math.round(Math.abs(v)).toLocaleString('pt-BR');
  const cor=r.marg>=40?'#2ECC71':r.marg>=20?'#FFB800':'#E74C3C';
  const isSup=p.operacao==='supley';
  const op=isSup?'SUPLEY':'3 CORACOES';
  let nomePerfil=p.nome_perfil||(isSup?(p.cavalo?'Cavalo - Carreta Locada':'Carreta - Conjunto Proprio'):p.vuc?'VUC':p.hr?(p.terceiro?'HR - Veiculo de Terceiro':'HR - Veiculo Proprio'):(p.terceiro?'VAN - Veiculo de Terceiro':'VAN - Veiculo Proprio'));
  const sub1=isSup?r.q+' viagens/mes  Matao -> Jundiai (264 km)  pedagio IDA pago pela Mandalog':p.vuc?r.q+' saidas/mes  16 garantidas  '+r.frete_unit_label:r.q+' saidas/mes  16 garantidas  '+r.frete_unit_label;
  const sub2=isSup?'R$ 2.421,60/viagem  receita bruta '+M(r.receita)+'/mes':'receita bruta '+M(r.receita)+'/mes  base GLP Guarulhos';
  const nota1=isSup?'Ida (5 eixos R$382,40): Mandalog paga  Volta: levanta 2 eixos -> paga 3 eixos (R$229,44)':p.vuc?'Motorista realiza a propria descarga - sem custo de ajudante':'';
  const nota2=(isSup&&p.cavalo)?'Carreta locada de parceira aprovada - R$250/viagem':'';
  const RH=54,RY0=750;
  let custosSVG='';
  r.rows.forEach((row,i)=>{
    const y=RY0+i*RH;
    custosSVG+='<text x="80" y="'+y+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="25" fill="#909090">'+esc(row.l)+'</text>';
    custosSVG+='<text x="1000" y="'+y+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="27" font-weight="700" fill="#E57373" text-anchor="end">- '+esc(M(row.v))+'</text>';
    if(i<r.rows.length-1)custosSVG+='<line x1="80" y1="'+(y+15)+'" x2="1000" y2="'+(y+15)+'" stroke="#222" stroke-width="1"/>';
  });
  const totY=RY0+r.rows.length*RH+22;
  return '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F4600A"/><stop offset="1" stop-color="#FFB800"/></linearGradient><linearGradient id="g2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1C1C1C"/><stop offset="1" stop-color="#141414"/></linearGradient></defs><rect width="'+W+'" height="'+H+'" fill="#0D0D0D"/><rect width="'+W+'" height="8" fill="url(#g1)"/><text x="80" y="82" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="700" fill="#555" letter-spacing="4">ESTUDO DE VIABILIDADE - OPERACAO '+esc(op)+'</text><text x="80" y="148" font-family="DejaVu Sans,Arial,sans-serif" font-size="52" font-weight="800" fill="#F2F0EB">MANDA<tspan fill="#F4600A">LOG</tspan></text><text x="80" y="225" font-family="DejaVu Sans,Arial,sans-serif" font-size="50" font-weight="800" fill="#F2F0EB">'+esc(nomePerfil)+'</text><text x="80" y="268" font-family="DejaVu Sans,Arial,sans-serif" font-size="25" fill="#888">'+esc(sub1)+'</text><text x="80" y="304" font-family="DejaVu Sans,Arial,sans-serif" font-size="24" fill="#666">'+esc(sub2)+'</text><rect x="60" y="335" width="960" height="285" rx="16" fill="url(#g2)" stroke="#252525" stroke-width="1"/><rect x="60" y="335" width="960" height="6" rx="3" fill="url(#g1)"/><text x="540" y="405" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" font-weight="700" fill="#666" text-anchor="middle" letter-spacing="3">LUCRO LIQUIDO ESTIMADO / MES</text><text x="540" y="540" font-family="DejaVu Sans,Arial,sans-serif" font-size="136" font-weight="800" fill="'+cor+'" text-anchor="middle">'+esc(M(r.liq))+'</text><text x="540" y="592" font-family="DejaVu Sans,Arial,sans-serif" font-size="27" font-weight="700" fill="'+cor+'" text-anchor="middle">Margem '+r.marg.toFixed(0)+'%  Projecao anual '+esc(M(r.liq*12))+'</text><text x="80" y="685" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" font-weight="700" fill="#F4600A" letter-spacing="2">RECEITA BRUTA</text><text x="1000" y="685" font-family="DejaVu Sans,Arial,sans-serif" font-size="38" font-weight="800" fill="#2ECC71" text-anchor="end">'+esc(M(r.receita))+'</text><line x1="80" y1="702" x2="1000" y2="702" stroke="#F4600A" stroke-width="2"/>'+custosSVG+'<line x1="80" y1="'+(totY-16)+'" x2="1000" y2="'+(totY-16)+'" stroke="#333" stroke-width="1.5"/><text x="80" y="'+(totY+26)+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="36" font-weight="800" fill="#F2F0EB">= LIQUIDO NO BOLSO</text><text x="1000" y="'+(totY+26)+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="44" font-weight="800" fill="'+cor+'" text-anchor="end">'+esc(M(r.liq))+'</text>'+(nota1?'<text x="80" y="'+(totY+78)+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" fill="#5A8FBB">'+esc(nota1)+'</text>':'')+(nota2?'<text x="80" y="'+(totY+112)+'" font-family="DejaVu Sans,Arial,sans-serif" font-size="22" fill="#5A8FBB">'+esc(nota2)+'</text>':'')+'<rect x="0" y="1282" width="'+W+'" height="68" fill="#141414"/><line x1="0" y1="1282" x2="'+W+'" y2="1282" stroke="#222" stroke-width="1"/><text x="80" y="1322" font-family="DejaVu Sans,Arial,sans-serif" font-size="21" fill="#555">Estimativa com custos medios de mercado. Ajustamos com seus numeros reais.</text></svg>';
}

const PERFIS_BASE={
  van_propria:{operacao:'3c'},van_terceiro:{operacao:'3c',terceiro:true},
  hr_proprio:{operacao:'3c',hr:true},hr_terceiro:{operacao:'3c',hr:true,terceiro:true},
  vuc:{operacao:'3c',vuc:true,diesel_flag:true},
  carreta:{operacao:'supley'},cavalo:{operacao:'supley',cavalo:true,loc_vg:250}
};

app.get('/health',(req,res)=>res.json({ok:true,service:'bot-viabilidade',cache:cache.size}));

app.post('/gerar',async(req,res)=>{
  try{
    const p=req.body;
    if(!p||!p.operacao)return res.status(400).json({erro:'operacao obrigatoria (3c|supley)'});
    const r=calcular(p);
    const svg=gerarSVG(p,r);
    const buf=await sharp(Buffer.from(svg)).png().toBuffer();
    const id=crypto.randomBytes(8).toString('hex');
    cache.set(id,{buf,ts:Date.now()});
    const host=req.protocol+'://'+req.get('host');
    res.json({ok:true,id,url:host+'/card/'+id,base64:buf.toString('base64'),
      liquido:Math.round(r.liq),receita:Math.round(r.receita),margem:Math.round(r.marg)});
  }catch(e){console.error(e);res.status(500).json({erro:e.message});}
});

app.get('/card/:id',(req,res)=>{
  const entry=cache.get(req.params.id);
  if(!entry)return res.status(404).json({erro:'Card expirado'});
  res.set('Content-Type','image/png');
  res.set('Cache-Control','public, max-age=1800');
  res.send(entry.buf);
});

app.get('/card-base/:perfil',(req,res)=>{
  const entry=cache.get('base_'+req.params.perfil);
  if(!entry)return res.status(404).json({erro:'Perfil invalido'});
  res.set('Content-Type','image/png');
  res.set('Cache-Control','public, max-age=86400');
  res.send(entry.buf);
});

async function preGerarBase(){
  for(const[id,p]of Object.entries(PERFIS_BASE)){
    const r=calcular(p);
    const svg=gerarSVG(p,r);
    const buf=await sharp(Buffer.from(svg)).png().toBuffer();
    cache.set('base_'+id,{buf,ts:Date.now()+999999999});
    console.log('  card base: '+id+'  liquido R$'+Math.round(r.liq).toLocaleString('pt-BR'));
  }
}

app.listen(PORT,async()=>{
  console.log('bot-viabilidade porta '+PORT);
  await preGerarBase();
  console.log('Pronto.');
});