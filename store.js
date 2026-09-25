const products = [
  {id:'tee',name:'T-shirt Seven',image:'IMG-20260617-WA0006(1).jpg',description:'T-shirt verde com assinatura Seven. Uma peça para fazer parte da tua história.'},
  {id:'polo',name:'Polo Seven',image:'IMG-20260617-WA0008(1).jpg',description:'Polo com identidade Seven. Indica a cor que preferes: rosa ou vermelho.'},
  {id:'custom',name:'A tua estampa',image:'IMG-20260708-WA0010(1).jpg',description:'T-shirts e sacolas personalizadas. Partilha a tua ideia e combina os detalhes connosco.'},
  {id:'street',name:'Seven Street Tee',image:'IMG_20260829_163923_927.webp',description:'Streetwear God Seven Line com presença e identidade moçambicana.'},
  {id:'black',name:'Seven Signature',image:'IMG_20260829_163739_990.webp',description:'Polo preto da linha Signature para um visual limpo e marcante.'},
  {id:'canvas',name:'Sacola Personalizada',image:'img_1788013265582.jpg',description:'A tua arte numa sacola resistente. Envia a ideia e nós tratamos da personalização.'}
];
const toggle=document.querySelector('.menu-toggle');
toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));document.querySelector('#navigation').classList.toggle('open',open)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){toggle?.setAttribute('aria-expanded','false');document.querySelector('#navigation')?.classList.remove('open')}});
const current=location.pathname.split('/').pop()||'index.html';
document.querySelectorAll('nav a').forEach(a=>{if(a.getAttribute('href')===current)a.setAttribute('aria-current','page')});
let category='Todos';
function filter(){const search=document.querySelector('#search');if(!search)return;const query=search.value.trim().toLocaleLowerCase('pt');let count=0;document.querySelectorAll('.product').forEach(card=>{const show=(category==='Todos'||card.dataset.category===category)&&card.textContent.toLocaleLowerCase('pt').includes(query);card.hidden=!show;if(show)count++});document.querySelector('#result-count').textContent=`${count} ${count===1?'peça':'peças'}`;document.querySelector('#empty').hidden=count!==0}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filter()}));
document.querySelector('#search')?.addEventListener('input',filter);
const dialog=document.createElement('dialog');dialog.className='product-dialog';dialog.setAttribute('aria-labelledby','detail-title');document.body.append(dialog);
document.querySelectorAll('[data-product]').forEach(button=>button.addEventListener('click',()=>{const p=products.find(item=>item.id===button.dataset.product);dialog.innerHTML=`<button class="close-dialog" aria-label="Fechar detalhes">×</button><div class="detail-grid"><img src="${p.image}" alt="${p.name}"><div class="detail-copy"><p class="eyebrow">GOD SEVEN LINE / COLECÇÃO</p><h2 id="detail-title">${p.name}</h2><p>${p.description}</p><strong>Preço sob consulta</strong><p>Confirmamos tamanhos, cores, disponibilidade e entrega pelo WhatsApp.</p><label for="size">Tamanho pretendido</label><select id="size"><option>Preciso de ajuda a escolher</option><option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option><option>XXL</option><option>Não se aplica (sacola)</option></select><a class="button order-link" target="_blank" rel="noopener">Encomendar no WhatsApp ↗</a><small>O tamanho escolhido está sujeito a confirmação.</small></div></div>`;const update=()=>{dialog.querySelector('.order-link').href='https://wa.me/258870204282?text='+encodeURIComponent(`Olá! Tenho interesse em ${p.name}. Tamanho: ${dialog.querySelector('select').value}. Podem confirmar o preço e a disponibilidade?`)};update();dialog.querySelector('select').addEventListener('change',update);dialog.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());dialog.showModal()}));
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
const reveals=document.querySelectorAll('.reveal');
if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('revealed');observer.unobserve(entry.target)}}),{threshold:.12});
  reveals.forEach(element=>observer.observe(element));
}else{reveals.forEach(element=>element.classList.add('revealed'))}
