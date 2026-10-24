/* Generic A/B workspace. Persona artwork and card hierarchy adapted from Merts customer catalog. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { dataset: null, personas: [], selectedPersonaIds: [], images: { a: [], b: [] }, busy: false, revision: 0, uploads: 0, uploadVersion: { a: 0, b: 0 } };
  const labels = { A:'Panel tercihi: A', B:'Panel tercihi: B', mixed:'Panel bölündü · net tercih yok', tie:'Panelde beraberlik', neither:'İki seçenek de tercih edilmedi', 'insufficient-data':'Karar için yeterli bağlam / değerlendirme yok', 'invalid-creative':'Desteklenmeyen iddialar bulundu' };
  const criterionLabels = { relevance:'Göreve ve kitleye uygunluk', credibility:'Güven / dayanak', clarity:'Anlaşılabilirlik', objectionResolution:'İtiraz ve sürtünme', attention:'Fark edilebilirlik', ctaFit:'Sonraki adımın uygunluğu' };
  const warningLabels = { ORDER_STABILITY_UNPROVEN:'Sunum sırasına karşı tutarlılık doğrulanamadı.', INCOMPLETE_PANEL_COVERAGE:'Geçerli ve desteklenen değerlendirme kapsamı eksik.', SCORE_PREFERENCE_DISAGREEMENT:'Puanlar ile tercihler farklı yönlerde.', SCENARIO_WEIGHT_SENSITIVE:'Sonuç senaryo ağırlıklarına duyarlı.', UNREPRESENTED_POPULATION_WEIGHT:'Panelin temsil etmediği bir pay var.' };
  const pct = n => n === null || n === undefined ? 'Bilinmiyor' : `%${Number(n).toFixed(1).replace('.0','')}`;
  function message(text, kind='info') { $('labMessage').textContent=text; $('labMessage').dataset.kind=kind; }
  function changed() { state.revision++; $('resultsArea').classList.add('lab-hidden'); updateControls(); }
  function updateControls() {
    if (!$('btnRun')) return;
    const selectedCount = state.selectedPersonaIds.length || state.personas.length;
    const count = $('panelMode').value === 'demo' ? Math.min(6,selectedCount) : selectedCount*3;
    const engine = $('engineSelector').value;
    const calls = count*6;
    $('runEstimate').textContent = `${count} kimlik · 2 ters sıralı tekrar · ${calls} değerlendirme${engine === 'local' ? ' · model çağrısı yok' : ' · gerçek model kullanımı'}`;
    $('btnRun').disabled = !state.dataset || state.busy || state.uploads > 0;
    $('btnRun').textContent = state.busy ? 'İşleniyor…' : !state.dataset ? 'Önce kitle kartları hazırlanıyor…' : engine === 'local' ? 'Yerel kurallarla dene' : `Luna ile değerlendir (${calls} görev)`;
    $('btnDerive').disabled = !state.dataset || state.busy || state.uploads > 0 || ['screen','flow'].includes($('artifactType').value);
  }
  function setBusy(value) { state.busy=value; updateControls(); }
  function context() { const variable=$('testedVariable'); return { objective:$('testObjective').value, task:$('testTask').value.trim(), surface:$('testSurface').value, changedElement:variable.selectedOptions?.[0]?.textContent || variable.value || 'Bütün konsept' }; }
  function getVariant(side) {
    const suffix=side.toUpperCase(), format=$('artifactType').value;
    const content=$(`artifactContent${suffix}`)?.value.trim() || '';
    const images=state.images[side];
    if (['screen','flow'].includes(format) && !images.length) throw new Error(`${suffix} için ekran görüntüsü yükleyin.`);
    if (format === 'html' && !content) throw new Error(`${suffix} HTML kodunu ekleyin.`);
    if (format === 'text' && !content) throw new Error(`${suffix} materyal metnini ekleyin.`);
    const product=state.dataset.products[0];
    return { id:`variant-${side}`, version:1, productId:product.id, platform:'generic', format,
      headline:$(`artifactTitle${suffix}`)?.value.trim() || `Varyant ${suffix}`,
      body:format === 'html' ? '' : content, html:format === 'html' ? content : undefined,
      callToAction:$(`artifactCta${suffix}`)?.value.trim() || '', images,
      testedVariable:$('testedVariable').value, productFactRefs:product.facts.map(f=>f.id), assumptions:[], generation:'manual', productClaims:[],
      referenceUrl:$(`artifactUrl${suffix}`)?.value.trim() || undefined };
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
      const result=await post('/api/run-experiment',{dataset:state.dataset,variantA,variantB,context:context(),repeats:2,panelMode:$('panelMode').value,selectedPersonaIds:state.selectedPersonaIds,engine:$('engineSelector').value});
      if (revision!==state.revision) { message('Girdiler değiştiği için önceki isteğin sonucu gösterilmedi. Güncel materyalleri yeniden değerlendirin.'); return; }
      renderResults(result);message('Değerlendirme tamamlandı. Tercihler sentetik paneli anlatır; ölçülmüş dönüşüm sonucu değildir.');
    } catch(error) { message(error.message,'error'); }
    finally { setBusy(false); }
  }
  async function derive() {
    if (state.busy) return;
    try {
      const source=getVariant('a'), revision=state.revision;
      if (source.images.length || ['screen','flow'].includes(source.format)) throw new Error('B için alternatif görseli yükleyin.');
      setBusy(true);message('Alternatif hazırlanıyor. A materyali korunacak.');
      const result=await post('/api/derive-b',{dataset:state.dataset,sourceVariantA:source,context:context(),testedVariable:$('testedVariable').value,angle:$('deriveAngle')?.value || 'concise',engine:$('engineSelector').value});
      if (revision!==state.revision) { message('Girdiler değişti; üretilen alternatif güncel B alanının üzerine yazılmadı.'); return; }
      const b=result.variantB;
      $('artifactTitleB').value=b.headline; $('artifactContentB').value=b.format==='html'?b.html:b.body;
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
      const htmlFiles=files.filter(file=>file.type==='text/html'||/\.html?$/i.test(file.name));
      if(htmlFiles.length) {
        if(files.length!==1) throw new Error('HTML dosyasını diğer görsellerden ayrı yükleyin.');
        const file=htmlFiles[0];
        if(file.size>100*1024) throw new Error('HTML dosyası en fazla 100 KB olabilir.');
        const html=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('HTML dosyası okunamadı.'));reader.readAsText(file);});
        if(html.length>20000) throw new Error('HTML kaynak kodu en fazla 20.000 karakter olabilir.');
        if(version!==state.uploadVersion[side]) return;
        state.images[side]=[];$(`artifactContent${side.toUpperCase()}`).value=html;$('artifactType').value='html';changed();renderImages(side);previewHtml();
        message(`${file.name} HTML materyali olarak yüklendi ve önizlendi.`);return;
      }
      const images=[];
      for(const file of files) {
        if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>2*1024*1024) throw new Error('PNG, JPEG veya WebP kullanın; her dosya en fazla 2 MB olmalı.');
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Dosya okunamadı.'));reader.readAsDataURL(file);});
        images.push({name:file.name,mimeType:file.type,data:String(data).split(',')[1]});
      }
      if (version!==state.uploadVersion[side]) return;
      state.images[side]=images;$('artifactType').value=images.length>1?'flow':'screen';changed();renderImages(side);previewHtml();message(`${images.length} görsel ${side.toUpperCase()} materyaline eklendi. Görseller değerlendirme isteği sırasında gönderilir.`);
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
    const format=$('artifactType').value, html=format==='html', visual=['screen','flow'].includes(format);
    document.querySelectorAll('[data-requires-copy]').forEach(group=>group.classList.toggle('lab-hidden',visual));
    document.querySelectorAll('.lab-content-label').forEach(label=>{label.textContent=html?'HTML kaynak kodu':'Materyal metni';});
    for(const side of ['A','B']) {
      const frame=$(`artifactHtml${side}`);frame.classList.toggle('lab-hidden',!html);
      if(html) frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta charset="utf-8">${$(`artifactContent${side}`).value}`;
      else frame.srcdoc='';
    }
  }
  function renderCards(personas, analysis) {
    const container=$('personasContainer');container.className='lab-personas';container.replaceChildren();
    if(!personas.length){container.innerHTML='<p class="lab-empty">Kart oluşturacak kitle bağlamı bulunamadı.</p>';return;}
    const cardsMap = new Map((analysis?.cards || []).map(c => [c.personaId, c]));
    personas.forEach((p,index)=>{
      const card=document.createElement('article');card.className='lab-persona';
      const anCard = cardsMap.get(p.id);
      const observed=p.observedFacts || [], inferred=p.derivedSignals || [], assumptions=p.assumptions || [];
      const total=observed.length+inferred.length+assumptions.length || 1;
      const section=(title,claims)=>`<strong>${title}</strong><ul>${claims.length?claims.map(c=>`<li>${escape(c.text || c)}</li>`).join(''):'<li>Bu grupta bilgi yok.</li>'}</ul>`;
      const weightDisplay = anCard?.scenarioWeightPercent !== undefined
        ? `%${anCard.scenarioWeightPercent} senaryo ağırlığı`
        : pct((p.weight?.value || 0)*100) + ' senaryo ağırlığı';
      const supportBadge = anCard?.support === 'source-context' ? 'Kaynak Verisi Destekli' : 'Kurgusal Senaryo';
      const testQ = anCard?.testQuestion ? `<div style="font-size:11px;color:#2563eb;margin-top:6px;font-style:italic;"><strong>Test Sorusu:</strong> ${escape(anCard.testQuestion)}</div>` : '';
      const selected=state.selectedPersonaIds.includes(p.id);

      // Clean punchy title: 2-3 words without brand suffix
      const rawTitle = p.title || `Persona ${index+1}`;
      const cleanTitle = rawTitle.split('·')[0].trim();

      // Archetype visual role tag & icon
      const lower = (cleanTitle + ' ' + (p.needs||[]).join(' ')).toLowerCase();
      let roleTag = 'KİTLE PROFİLİ';
      let roleColor = '#2563eb';

      if (lower.includes('entegrasyon') || lower.includes('yazılım') || lower.includes('api') || lower.includes('kurulum') || lower.includes('kod') || lower.includes('developer') || lower.includes('teknik')) {
        roleTag = 'YAZILIM & TECH';
        roleColor = '#2563eb';
      } else if (lower.includes('kahve') || lower.includes('tat') || lower.includes('aroma') || lower.includes('demle') || lower.includes('tazelik') || lower.includes('çekirdek')) {
        roleTag = 'KAHVE & GURME';
        roleColor = '#b45309';
      } else if (lower.includes('mobilya') || lower.includes('tasarım') || lower.includes('ahşap') || lower.includes('alan') || lower.includes('modüler') || lower.includes('mekan')) {
        roleTag = 'TASARIM & MEKAN';
        roleColor = '#7c3aed';
      } else if (lower.includes('kurucu') || lower.includes('büyüme') || lower.includes('girişim') || lower.includes('şablon') || lower.includes('taktik') || lower.includes('içerik')) {
        roleTag = 'KURUCU & BÜYÜME';
        roleColor = '#4f46e5';
      } else if (lower.includes('fiyat') || lower.includes('maliyet') || lower.includes('bütçe') || lower.includes('paket') || lower.includes('plan')) {
        roleTag = 'BÜTÇE & DEĞER';
        roleColor = '#059669';
      }

      card.innerHTML=`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <label class="lab-persona-pick" style="margin:0; font-size:11px; font-weight:600; color:#475569; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" data-persona-id="${escape(p.id)}" ${selected?'checked':''}>
            <span>Test Paneline Dahil</span>
          </label>
          <span style="font-size:10px; font-weight:600; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:12px;">${weightDisplay}</span>
        </div>
        <div class="lab-persona-head" style="align-items:flex-start; gap:14px;">
          <div class="lab-avatar" style="position:relative; width:84px; flex-shrink:0; text-align:center;">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:6px; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
              <img src="/avatars/persona-${index%6+1}.svg" alt="${escape(cleanTitle)}" style="width:72px; height:80px; display:block; margin:auto;">
            </div>
            <span style="display:inline-block; font-size:9px; font-weight:700; color:${roleColor}; background:${roleColor}14; border:1px solid ${roleColor}33; padding:2px 6px; border-radius:6px; margin-top:5px; letter-spacing:0.3px;">${roleTag}</span>
          </div>
          <div style="flex:1; min-width:0;">
            <span class="lab-status" data-kind="synthetic-demo" style="font-size:10px; padding:2px 6px; border-radius:4px; font-weight:600;">${supportBadge}</span>
            <h3 style="font-size:19px; font-weight:800; color:#0f172a; margin:4px 0 6px 0; letter-spacing:-0.02em; line-height:1.25;">${escape(cleanTitle)}</h3>
            <p style="font-size:12px; color:#475569; line-height:1.45; margin:0 0 8px 0;">${escape(p.summary)}</p>
          </div>
        </div>
        <div class="lab-chips" style="margin:10px 0 8px 0;">${(p.needs||[]).slice(0,3).map(n=>`<span class="lab-chip">${escape(n)}</span>`).join('')}</div>
        <div class="lab-need" style="margin-bottom:6px; padding:8px 12px; font-size:12px;"><strong>Öne Çıkan İhtiyaç:</strong> ${escape(anCard?.need || p.needs?.[0] || 'Belirtilmedi')}</div>
        <div class="lab-objection" style="margin-bottom:8px; padding:8px 12px; font-size:12px;"><strong>Temel Çekince:</strong> ${escape(anCard?.objections?.[0] || p.objections?.[0] || 'Belirtilmedi')}</div>
        ${testQ}
        <details style="margin-top:10px; padding-top:8px; border-top:1px dashed #e2e8f0; font-size:11px;">
          <summary style="cursor:pointer; color:#64748b; font-weight:600;">Detaylı Karar Kuralları & Sınırlar</summary>
          <div class="lab-evidence-bar" aria-label="Kart bilgisinin kaynak dağılımı" style="margin-top:8px;"><span style="width:${observed.length/total*100}%;background:#6895cb"></span><span style="width:${inferred.length/total*100}%;background:#9b8abd"></span><span style="width:${assumptions.length/total*100}%;background:#d6b379"></span></div>
          <div class="lab-legend" style="margin:6px 0 10px 0;"><span>${observed.length} kaynak</span><span>${inferred.length} çıkarım</span><span>${assumptions.length} varsayım</span></div>
          ${section('Karar kuralları',(p.decisionRules||[]).map(r=>({text:`${r.condition} → ${r.reason}`})))}${section('Bilinmeyenler',p.unknowns||[])}
          <p style="margin-top:6px; color:#94a3b8;">Referanslar: ${escape((p.evidenceRefs||[]).join(', ') || 'Yok')}</p>
        </details>`;
      container.appendChild(card);
    });
    container.querySelectorAll('[data-persona-id]').forEach(input=>input.addEventListener('change',()=>{
      state.selectedPersonaIds=Array.from(container.querySelectorAll('[data-persona-id]:checked')).map(item=>item.dataset.personaId);
      changed();
    }));
  }
  function renderAudience(summary,panel,dataset) {
    state.dataset=dataset;state.personas=panel?.personas || [];state.selectedPersonaIds=state.personas.map(persona=>persona.id);changed();
    $('audienceSummarySection').style.display='block';
    const kind=summary.provenance?.kind || (dataset?.synthetic?'synthetic-demo':'declared-research');
    const provenance={ 'synthetic-demo':'Sentetik demo verisi', 'declared-research':'Kullanıcı / model beyanı', 'source-data':'Kaynak verisi · eksikler bilinmiyor' }[kind] || 'Kitle verisi';
    $('activeDatasetLabel').textContent=provenance;$('tdHandle').textContent=summary.handle || 'Genel Kitle';$('tdPopulation').textContent=summary.population || 'engaged-audience';
    const gender=summary.demographics?.gender;
    if (!gender || (gender.male === null && gender.female === null)) {
      $('tdGender').textContent='Bilinmiyor';
      $('barGenderMale').style.width='0%';
      $('barGenderFemale').style.width='0%';
    } else {
      $('tdGender').textContent=`Erkek: ${pct(gender.male)} / Kadın: ${pct(gender.female)}`;
      $('barGenderMale').style.width=`${gender.male ?? 0}%`;$('barGenderFemale').style.width=`${gender.female ?? 0}%`;
    }
    $('tdAge').textContent=summary.demographics?.topAgeGroup || 'Bilinmiyor';
    $('tdCities').textContent=(summary.demographics?.topCities && summary.demographics.topCities.length)?summary.demographics.topCities.map(c=>`${c.city} (${pct(c.percentage)})`).join(', '):'Bilinmiyor';
    const metrics=summary.metrics || {};
    const contentCount=metrics.contentCount ?? summary.recentPosts?.length ?? 0;
    const eventCount=metrics.eventCount ?? 0;
    const researchCount=metrics.researchCount ?? 0;
    const totalAudience=summary.totalAudience !== null && summary.totalAudience !== undefined ? summary.totalAudience.toLocaleString('tr-TR') : 'Bilinmiyor';
    $('tdPosts').textContent=`${contentCount} içerik · ${eventCount} olay · ${researchCount} araştırma (Kitle: ${totalAudience})`;
    let note=$('sourceProvenance');if(!note){note=document.createElement('p');note.id='sourceProvenance';note.className='lab-source-note';$('personasContainer').before(note);}
    note.textContent=`${provenance}. ${(summary.provenance?.notices||[]).join(' ')}`;
    renderCards(state.personas, panel?.analysis || dataset?.analysis);updateControls();
  }
  function renderResults(result) {
    const agg=result.aggregate,votes=result.summary.votes;
    const an=result.analysis;
    $('resWinnerTitle').textContent=labels[result.summary.decision] || an?.headline || 'Karar üretilemedi';
    $('resEngine').textContent=result.evaluationMode==='local-rules'?'Yerel kurallar · model kullanılmadı':`Model değerlendirmesi · istenen: ${result.model}`;
    $('resProvenance').textContent=`Veri: ${result.provenance.datasetSynthetic?'sentetik demo':'kaynak / beyan paketi'} · Panel: sentetik · Eşit senaryo ağırlıkları. Görev: ${result.context?.task || 'Belirtilmedi'}`;
    $('resTiming').textContent=`${result.panelSize} kimlik · ${result.repeats} tekrar · ${agg.completion.validTasks}/${agg.completion.expectedTasks} geçerli görev · ${(result.timing.totalMs/1000).toFixed(1)} sn`;
    $('barVoteA').style.width=`${votes.a}%`;$('barVoteB').style.width=`${votes.b}%`;$('barVoteTie').style.width=`${Math.max(0,100-votes.a-votes.b)}%`;
    $('resVotes').textContent=`A ${pct(votes.a)} · B ${pct(votes.b)} · Beraberlik ${pct(votes.tie)} · İkisi de değil ${pct(votes.neither)} · Bağlam yetersiz ${pct(votes.insufficientContext)} · Eksik ${pct(votes.missing)}`;
    const claims=[...new Set((result.creativeIssues||[]).flatMap(i=>i.unsupportedClaims))];
    $('resDiagnostics').textContent=[...agg.warnings.map(w=>warningLabels[w]||w),...claims.map(c=>`İşaretlenen iddia: ${c}`)].join(' ');
    
    let headlineEl=$('resAnalysisHeadline');
    if(!headlineEl){headlineEl=document.createElement('div');headlineEl.id='resAnalysisHeadline';$('resWinnerTitle').after(headlineEl);}
    if(an?.headline){
      const gapBadge=an.preferenceGapPoints !== null && an.preferenceGapPoints !== undefined ? `<span class="lab-status" style="margin-left:8px;font-weight:600;background:#eff6ff;color:#2563eb;border-color:#bfdbfe;">B vs A: ${an.preferenceGapPoints > 0 ? '+' : ''}${an.preferenceGapPoints} puan fark (Dönüşüm artışı değildir)</span>` : '';
      headlineEl.innerHTML=`<p style="font-size:14px;font-weight:600;color:var(--text-main);margin:4px 0 10px;">${escape(an.headline)}${gapBadge}</p>`;
    } else {headlineEl.innerHTML='';}

    if(an?.criteria && an.criteria.length){
      $('resultCriteria').innerHTML=an.criteria.map(c=>{
        const deltaStr=c.delta !== null ? (c.delta > 0 ? `+${c.delta}` : `${c.delta}`) : '—';
        const advClass=c.advantage === 'b' ? 'color:#15803d;font-weight:700;' : c.advantage === 'a' ? 'color:#1d4ed8;font-weight:700;' : 'color:#64748b;';
        return `<div class="lab-criterion"><span>${escape(c.label || criterionLabels[c.criterion] || c.criterion)}</span><span>A: ${c.a ?? '—'} / 4</span><span>B: ${c.b ?? '—'} / 4</span><span style="${advClass}">Fark (B-A): ${deltaStr}</span></div>`;
      }).join('');
    } else {
      $('resultCriteria').innerHTML=Object.entries(result.criterionComparison).map(([key,value])=>`<div class="lab-criterion"><span>${escape(criterionLabels[key]||key)}</span><span>A: ${value.a ?? '—'} / 4</span><span>B: ${value.b ?? '—'} / 4</span></div>`).join('');
    }

    let extraEl=$('resExtraAnalysis');
    if(!extraEl){extraEl=document.createElement('div');extraEl.id='resExtraAnalysis';extraEl.style.marginTop='16px';$('resultCriteria').after(extraEl);}
    const driversHtml=(an?.drivers && an.drivers.length)?`<div style="margin-bottom:14px;"><strong style="font-size:12px;color:var(--text-main);">Öne Çıkan Karar Belirleyicileri (Drivers):</strong><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">${an.drivers.map(d=>`<span class="lab-chip" style="font-weight:600;border:1px solid #bfdbfe;background:#f0f7ff;color:#1e40af;">${escape(d.label)} · ${d.advantage === 'b' ? 'B Avantajı' : d.advantage === 'a' ? 'A Avantajı' : 'Beraberlik'} (${d.delta > 0 ? '+' : ''}${d.delta})</span>`).join('')}</div></div>`:'';
    const nextEditsHtml=(an?.nextEdits && an.nextEdits.length)?`<div style="margin-bottom:14px;background:#f8fafc;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;"><strong style="font-size:12px;color:var(--text-main);">Önerilen Sonraki Düzenlemeler:</strong><ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#475569;line-height:1.6;">${an.nextEdits.map(e=>`<li><strong>${escape(e.title)}:</strong> ${escape(e.instruction)} <span style="color:#64748b;">(${escape(e.reason)})</span></li>`).join('')}</ul></div>`:'';
    const questionsHtml=(an?.unansweredQuestions && an.unansweredQuestions.length)?`<div style="margin-bottom:14px;background:#fffbf0;padding:12px 14px;border:1px solid #fed7aa;border-radius:8px;"><strong style="font-size:12px;color:#9a3412;">Kitle Tarafından Sorulan Cevapsız Sorular:</strong><ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#7c2d12;line-height:1.6;">${an.unansweredQuestions.map(q=>`<li>${escape(q.question)} <span style="font-size:10px;color:#9a3412;">(${q.occurrences} tekrar · ${q.personaIds.length} persona)</span></li>`).join('')}</ul></div>`:'';
    extraEl.innerHTML=driversHtml+nextEditsHtml+questionsHtml;

    $('resultsSegmentsContainer').innerHTML=result.segmentBreakdown.map((segment,index)=>{
      const persona=agg.personas[index];
      const anSegment=an?.segments?.find(s=>s.personaId === persona?.personaId || s.title === segment.personaTitle);
      const consensusBadge = anSegment?.consensus ? `<span class="lab-status" style="font-size:10px;margin-left:6px;">${escape(({unanimous:'Oybirliği',majority:'Çoğunluk',divided:'Bölünmüş',missing:'Eksik'})[anSegment.consensus] || anSegment.consensus)}</span>` : '';
      const repReason = anSegment?.representativeReason ? `<p style="font-size:11px;color:#1e3a8a;margin-top:6px;background:#eff6ff;padding:6px 8px;border-radius:4px;"><strong>Temsili Gerekçe:</strong> ${escape(anSegment.representativeReason.explanation)}</p>` : '';
      return `<article class="lab-segment"><h3>${escape(segment.personaTitle)}${consensusBadge}</h3><span class="lab-status">${escape(({a:'A tercihi',b:'B tercihi',mixed:'Bölünmüş',tie:'Beraberlik',neither:'İkisi de değil','insufficient-data':'Bilgi yetersiz','invalid-creative':'Desteksiz iddia'})[segment.winner])}</span><div class="lab-score-line">A <meter min="0" max="100" value="${persona?.scoreA || 0}"></meter><span>${persona?.scoreA ?? '—'}</span></div><div class="lab-score-line">B <meter min="0" max="100" value="${persona?.scoreB || 0}"></meter><span>${persona?.scoreB ?? '—'}</span></div><p>${escape(segment.pairExplanation)}</p>${repReason}<details><summary class="lab-help">A / B örnek gerekçeleri</summary><p>A: ${escape(segment.reasonA)}</p><p>B: ${escape(segment.reasonB)}</p></details></article>`;
    }).join('');
    $('resultsArea').classList.remove('lab-hidden');$('resultsArea').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function init() {
    $('btnRun').addEventListener('click',run);$('btnDerive').addEventListener('click',derive);
    for(const side of ['a','b']) $(`artifactFiles${side.toUpperCase()}`).addEventListener('change',event=>upload(side,event.target));
    document.querySelectorAll('[data-clear-images]').forEach(button=>button.addEventListener('click',()=>{const side=button.dataset.clearImages;state.uploadVersion[side]++;state.images[side]=[];$(`artifactFiles${side.toUpperCase()}`).value='';$(`artifactContent${side.toUpperCase()}`).value='';renderImages(side);previewHtml();changed();}));
    for(const id of ['testObjective','testTask','testSurface','testedVariable','panelMode','engineSelector','artifactTitleA','artifactTitleB','artifactContentA','artifactContentB','artifactUrlA','artifactUrlB']) $(id).addEventListener('input',()=>{changed();previewHtml();});
    $('artifactType').addEventListener('change',()=>{document.querySelectorAll('.lab-content-label').forEach(label=>{label.textContent=$('artifactType').value==='html'?'HTML kaynak kodu':'Materyal metni / ekran açıklaması';});changed();previewHtml();});
    updateControls();previewHtml();
  }
  window.OctopiqUI={renderAudience,renderResults,getVariant,context,state,run,derive,renderCards};
  window.TestBeforeInvestUI=window.OctopiqUI;
  document.addEventListener('DOMContentLoaded',init);
})();
