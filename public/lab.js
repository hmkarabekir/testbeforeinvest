/* Generic A/B workspace. Persona artwork and card hierarchy adapted from Merts customer catalog. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { dataset: null, personas: [], images: { a: [], b: [] }, busy: false, revision: 0, uploads: 0, uploadVersion: { a: 0, b: 0 } };
  const labels = { A:'Panel tercihi: A', B:'Panel tercihi: B', mixed:'Panel bölündü · net tercih yok', tie:'Panelde beraberlik', neither:'İki seçenek de tercih edilmedi', 'insufficient-data':'Karar için yeterli bağlam / değerlendirme yok', 'invalid-creative':'Desteklenmeyen iddialar bulundu' };
  const criterionLabels = { relevance:'Göreve ve kitleye uygunluk', credibility:'Güven / dayanak', clarity:'Anlaşılabilirlik', objectionResolution:'İtiraz ve sürtünme', attention:'Fark edilebilirlik', ctaFit:'Sonraki adımın uygunluğu' };
  const warningLabels = { ORDER_STABILITY_UNPROVEN:'Sunum sırasına karşı tutarlılık doğrulanamadı.', INCOMPLETE_PANEL_COVERAGE:'Geçerli ve desteklenen değerlendirme kapsamı eksik.', SCORE_PREFERENCE_DISAGREEMENT:'Puanlar ile tercihler farklı yönlerde.', SCENARIO_WEIGHT_SENSITIVE:'Sonuç senaryo ağırlıklarına duyarlı.', UNREPRESENTED_POPULATION_WEIGHT:'Panelin temsil etmediği bir pay var.' };
  const pct = n => n === null || n === undefined ? 'Bilinmiyor' : `%${Number(n).toFixed(1).replace('.0','')}`;
  function message(text, kind='info') { $('labMessage').textContent=text; $('labMessage').dataset.kind=kind; }
  function changed() { state.revision++; $('resultsArea').classList.add('lab-hidden'); updateControls(); }
  function updateControls() {
    if (!$('btnRun')) return;
    const count = $('panelMode').value === 'demo' ? Math.min(6,state.personas.length) : state.personas.length*3;
    const engine = $('engineSelector').value;
    const calls = count*6;
    $('runEstimate').textContent = `${count} kimlik · 2 ters sıralı tekrar · ${calls} değerlendirme${engine === 'local' ? ' · model çağrısı yok' : ' · gerçek model kullanımı'}`;
    $('btnRun').disabled = !state.dataset || state.busy || state.uploads > 0;
    $('btnRun').textContent = state.busy ? 'İşleniyor…' : !state.dataset ? 'Önce kitle kartları hazırlanıyor…' : engine === 'local' ? 'Yerel kurallarla dene' : `Luna ile değerlendir (${calls} görev)`;
    $('btnDerive').disabled = !state.dataset || state.busy || state.uploads > 0 || ['screen','flow'].includes($('artifactType').value);
  }
  function setBusy(value) { state.busy=value; updateControls(); }
  function context() { return { objective:$('testObjective').value, task:$('testTask').value.trim(), surface:$('testSurface').value, changedElement:$('testedVariable').selectedOptions[0].textContent }; }
  function getVariant(side) {
    const suffix=side.toUpperCase(), format=$('artifactType').value;
    const content=$(`artifactContent${suffix}`).value.trim();
    const images=state.images[side];
    if (['screen','flow'].includes(format) && !images.length) throw new Error(`${suffix} için ekran görüntüsü yükleyin.`);
    if (format === 'html' && !content) throw new Error(`${suffix} HTML kodunu ekleyin.`);
    if (format === 'text' && !content) throw new Error(`${suffix} materyal metnini ekleyin.`);
    const product=state.dataset.products[0];
    return { id:`variant-${side}`, version:1, productId:product.id, platform:'generic', format,
      headline:$(`artifactTitle${suffix}`).value.trim() || `Varyant ${suffix}`,
      body:format === 'html' ? '' : content, html:format === 'html' ? content : undefined,
      callToAction:$(`artifactCta${suffix}`).value.trim(), images,
      testedVariable:$('testedVariable').value, productFactRefs:product.facts.map(f=>f.id), assumptions:[], generation:'manual', productClaims:[],
      referenceUrl:$(`artifactUrl${suffix}`).value.trim() || undefined };
  }
  async function post(url, payload) {
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const value=await response.json();
    if (!response.ok) throw new Error(value.error || 'İstek tamamlanamadı.');
    return value;
  }
  async function run() {
    if (state.busy) return;
    try {
      if (!state.dataset) throw new Error('Önce kitle bilgisi seçin.');
      if (!context().task) throw new Error('Kullanıcının yapmak istediği görevi yazın.');
      const variantA=getVariant('a'), variantB=getVariant('b');
      if ($('engineSelector').value==='local' && (variantA.images.length || variantB.images.length)) throw new Error('Yerel kurallar görüntü okuyamaz. Görsel analizi için Luna seçin. Bu işlem model kullanır.');
      const revision=state.revision;
      setBusy(true);message('Panel değerlendiriliyor. Sonuç hazır olana kadar bu sayfayı açık tutun.');
      const result=await post('/api/run-experiment',{dataset:state.dataset,variantA,variantB,context:context(),repeats:2,panelMode:$('panelMode').value,engine:$('engineSelector').value});
      if (revision!==state.revision) { message('Girdiler değiştiği için önceki isteğin sonucu gösterilmedi. Güncel materyalleri yeniden değerlendirin.'); return; }
      renderResults(result);message('Değerlendirme tamamlandı. Tercihler sentetik paneli anlatır; ölçülmüş dönüşüm sonucu değildir.');
    } catch(error) { message(error.message,'error'); }
    finally { setBusy(false); }
  }
  async function derive() {
    if (state.busy) return;
    try {
      const source=getVariant('a'), revision=state.revision;
      if (source.images.length) throw new Error('Bu yardımcı metin ve HTML düzenler; görseller aynı kalır. Görsel B alternatifini yükleyin veya görselleri çıkarıp metin alternatifi üretin.');
      setBusy(true);message('Alternatif hazırlanıyor. A materyali korunacak.');
      const result=await post('/api/derive-b',{dataset:state.dataset,sourceVariantA:source,context:context(),testedVariable:$('testedVariable').value,angle:$('deriveAngle').value,engine:$('engineSelector').value});
      if (revision!==state.revision) { message('Girdiler değişti; üretilen alternatif güncel B alanının üzerine yazılmadı.'); return; }
      const b=result.variantB;
      $('artifactTitleB').value=b.headline; $('artifactContentB').value=b.format==='html'?b.html:b.body; $('artifactCtaB').value=b.callToAction;
      changed();previewHtml();
      message(`${result.evaluationMode==='local-rules'?'Yerel örnek':'Model alternatifi'} hazır. Değişen öğeler: ${result.changedElement}. Üretilen B henüz değerlendirilmedi.`);
    } catch(error) { message(error.message,'error'); }
    finally { setBusy(false); }
  }
  async function upload(side, input) {
    const version=++state.uploadVersion[side];
    state.uploads++;updateControls();
    try {
      const files=Array.from(input.files || []);
      if(files.length>3) throw new Error('Her varyanta en fazla 3 görsel eklenebilir.');
      const images=[];
      for(const file of files) {
        if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2*1024*1024) throw new Error('PNG, JPEG veya WebP kullanın; her dosya en fazla 2 MB olmalı.');
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Dosya okunamadı.'));reader.readAsDataURL(file);});
        images.push({name:file.name,mimeType:file.type,data:String(data).split(',')[1]});
      }
      if (version!==state.uploadVersion[side]) return;
      state.images[side]=images;changed();renderImages(side);message(`${images.length} görsel ${side.toUpperCase()} materyaline eklendi. Görseller değerlendirme isteği sırasında gönderilir.`);
    } catch(error) { input.value='';message(error.message,'error'); }
    finally {state.uploads--;updateControls();}
  }
  function renderImages(side) {
    const container=$(`artifactPreview${side.toUpperCase()}`);container.replaceChildren();
    for(const image of state.images[side]) {
      const figure=document.createElement('figure'), img=document.createElement('img'), caption=document.createElement('figcaption');
      img.className='lab-image';img.src=`data:${image.mimeType};base64,${image.data}`;img.alt=image.name;caption.textContent=image.name;
      figure.append(img,caption);container.appendChild(figure);
    }
  }
  function previewHtml() {
    const html=$('artifactType').value==='html';
    for(const side of ['A','B']) {
      const frame=$(`artifactHtml${side}`);frame.classList.toggle('lab-hidden',!html);
      if(html) frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta charset="utf-8">${$(`artifactContent${side}`).value}`;
      else frame.srcdoc='';
    }
  }
  function renderCards(personas) {
    const container=$('personasContainer');container.className='lab-personas';container.replaceChildren();
    if(!personas.length){container.innerHTML='<p class="lab-empty">Kart oluşturacak kitle bağlamı bulunamadı.</p>';return;}
    personas.forEach((p,index)=>{
      const card=document.createElement('article');card.className='lab-persona';
      const observed=p.observedFacts || [], inferred=p.derivedSignals || [], assumptions=p.assumptions || [];
      const total=observed.length+inferred.length+assumptions.length || 1;
      const section=(title,claims)=>`<strong>${title}</strong><ul>${claims.length?claims.map(c=>`<li>${escape(c.text || c)}</li>`).join(''):'<li>Bu grupta bilgi yok.</li>'}</ul>`;
      card.innerHTML=`<div class="lab-persona-head"><div class="lab-avatar"><img src="/avatars/persona-${index%6+1}.svg" alt="Kurgusal persona çizimi"><small>Kurgusal temsil</small></div><div><span class="lab-status" data-kind="synthetic-demo">Simülasyon personası ${index+1}</span><h3>${escape(p.title)}</h3><span class="lab-help">${pct((p.weight?.value || 0)*100)} senaryo ağırlığı · nüfus payı değildir</span></div></div><p>${escape(p.summary)}</p><div class="lab-chips">${(p.needs||[]).slice(0,3).map(n=>`<span class="lab-chip">${escape(n)}</span>`).join('')}</div><div class="lab-need"><strong>Öne çıkan ihtiyaç</strong><br>${escape(p.needs?.[0] || 'Belirtilmedi')}</div><div class="lab-objection"><strong>Çekince:</strong> ${escape(p.objections?.[0] || 'Belirtilmedi')}</div><div class="lab-evidence-bar" aria-label="Kart bilgisinin kaynak dağılımı"><span style="width:${observed.length/total*100}%;background:#6895cb"></span><span style="width:${inferred.length/total*100}%;background:#9b8abd"></span><span style="width:${assumptions.length/total*100}%;background:#d6b379"></span></div><div class="lab-legend"><span>${observed.length} kaynak / beyan</span><span>${inferred.length} çıkarım</span><span>${assumptions.length} varsayım</span></div><details><summary>Karar kuralları ve bilgi sınırları</summary>${section('Karar kuralları',(p.decisionRules||[]).map(r=>({text:`${r.condition} → ${r.reason}`})))}${section('Bilinmeyenler',p.unknowns||[])}</details><details><summary>Kaynaklar, çıkarımlar ve varsayımlar</summary>${section('Kaynak / beyan',observed)}${section('Çıkarım',inferred)}${section('Varsayım',assumptions)}<p>Kaynak referansları: ${escape((p.evidenceRefs||[]).join(', ') || 'Yok')}</p></details>`;
      container.appendChild(card);
    });
  }
  function renderAudience(summary,panel,dataset) {
    state.dataset=dataset;state.personas=panel?.personas || [];changed();
    $('audienceSummarySection').style.display='block';
    const kind=summary.provenance?.kind || (dataset?.synthetic?'synthetic-demo':'declared-research');
    const provenance={ 'synthetic-demo':'Sentetik demo verisi', 'declared-research':'Kullanıcı / model beyanı', 'source-data':'Kaynak verisi · eksikler bilinmiyor' }[kind];
    $('activeDatasetLabel').textContent=provenance;$('tdHandle').textContent=summary.handle;$('tdPopulation').textContent=summary.population;
    const gender=summary.demographics.gender;
    $('tdGender').textContent=`Erkek: ${pct(gender.male)} / Kadın: ${pct(gender.female)}`;
    $('barGenderMale').style.width=`${gender.male ?? 0}%`;$('barGenderFemale').style.width=`${gender.female ?? 0}%`;
    $('tdAge').textContent=summary.demographics.topAgeGroup || 'Bilinmiyor';
    $('tdCities').textContent=summary.demographics.topCities.length?summary.demographics.topCities.map(c=>`${c.city} (${pct(c.percentage)})`).join(', '):'Bilinmiyor';
    $('tdPosts').textContent=`${summary.recentPosts?.length || 0} içerik · toplam kitle ${summary.totalAudience ?? 'bilinmiyor'}`;
    let note=$('sourceProvenance');if(!note){note=document.createElement('p');note.id='sourceProvenance';note.className='lab-source-note';$('personasContainer').before(note);}
    note.textContent=`${provenance}. ${(summary.provenance?.notices||[]).join(' ')}`;
    renderCards(state.personas);updateControls();
  }
  function renderResults(result) {
    const agg=result.aggregate,votes=result.summary.votes;
    $('resWinnerTitle').textContent=labels[result.summary.decision] || 'Karar üretilemedi';
    $('resEngine').textContent=result.evaluationMode==='local-rules'?'Yerel kurallar · model kullanılmadı':`Model değerlendirmesi · istenen: ${result.model}`;
    $('resProvenance').textContent=`Veri: ${result.provenance.datasetSynthetic?'sentetik demo':'kaynak / beyan paketi'} · Panel: sentetik · Eşit senaryo ağırlıkları. Görev: ${result.context?.task || 'Belirtilmedi'}`;
    $('resTiming').textContent=`${result.panelSize} kimlik · ${result.repeats} tekrar · ${agg.completion.validTasks}/${agg.completion.expectedTasks} geçerli görev · ${(result.timing.totalMs/1000).toFixed(1)} sn`;
    $('barVoteA').style.width=`${votes.a}%`;$('barVoteB').style.width=`${votes.b}%`;$('barVoteTie').style.width=`${Math.max(0,100-votes.a-votes.b)}%`;
    $('resVotes').textContent=`A ${pct(votes.a)} · B ${pct(votes.b)} · Beraberlik ${pct(votes.tie)} · İkisi de değil ${pct(votes.neither)} · Bağlam yetersiz ${pct(votes.insufficientContext)} · Eksik ${pct(votes.missing)}`;
    const claims=[...new Set((result.creativeIssues||[]).flatMap(i=>i.unsupportedClaims))];
    $('resDiagnostics').textContent=[...agg.warnings.map(w=>warningLabels[w]||w),...claims.map(c=>`İşaretlenen iddia: ${c}`)].join(' ');
    $('resultCriteria').innerHTML=Object.entries(result.criterionComparison).map(([key,value])=>`<div class="lab-criterion"><span>${escape(criterionLabels[key]||key)}</span><span>A: ${value.a ?? '—'} / 4</span><span>B: ${value.b ?? '—'} / 4</span></div>`).join('');
    $('resultsSegmentsContainer').innerHTML=result.segmentBreakdown.map((segment,index)=>{
      const persona=agg.personas[index];
      return `<article class="lab-segment"><h3>${escape(segment.personaTitle)}</h3><span class="lab-status">${escape(({a:'A tercihi',b:'B tercihi',mixed:'Bölünmüş',tie:'Beraberlik',neither:'İkisi de değil','insufficient-data':'Bilgi yetersiz','invalid-creative':'Desteksiz iddia'})[segment.winner])}</span><div class="lab-score-line">A <meter min="0" max="100" value="${persona?.scoreA || 0}"></meter><span>${persona?.scoreA ?? '—'}</span></div><div class="lab-score-line">B <meter min="0" max="100" value="${persona?.scoreB || 0}"></meter><span>${persona?.scoreB ?? '—'}</span></div><p>${escape(segment.pairExplanation)}</p><details><summary class="lab-help">A / B örnek gerekçeleri</summary><p>A: ${escape(segment.reasonA)}</p><p>B: ${escape(segment.reasonB)}</p></details></article>`;
    }).join('');
    $('resultsArea').classList.remove('lab-hidden');$('resultsArea').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function init() {
    $('btnRun').addEventListener('click',run);$('btnDerive').addEventListener('click',derive);
    for(const side of ['a','b']) $(`artifactFiles${side.toUpperCase()}`).addEventListener('change',event=>upload(side,event.target));
    document.querySelectorAll('[data-clear-images]').forEach(button=>button.addEventListener('click',()=>{const side=button.dataset.clearImages;state.uploadVersion[side]++;state.images[side]=[];$(`artifactFiles${side.toUpperCase()}`).value='';renderImages(side);changed();}));
    for(const id of ['testObjective','testTask','testSurface','testedVariable','panelMode','engineSelector','artifactTitleA','artifactTitleB','artifactContentA','artifactContentB','artifactCtaA','artifactCtaB','artifactUrlA','artifactUrlB']) $(id).addEventListener('input',()=>{changed();previewHtml();});
    $('artifactType').addEventListener('change',()=>{document.querySelectorAll('.lab-content-label').forEach(label=>{label.textContent=$('artifactType').value==='html'?'HTML kaynak kodu':'Materyal metni / ekran açıklaması';});changed();previewHtml();});
    updateControls();
  }
  window.OctopiqUI={renderAudience,renderResults,getVariant,context,state,run,derive,renderCards};
  window.TestBeforeInvestUI=window.OctopiqUI;
  document.addEventListener('DOMContentLoaded',init);
})();
