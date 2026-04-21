'use client';

// =====================================================================
// RS ZEVAR ERP — AI Enhance Modal
// File: app/inventory/_components/AiEnhanceModal.js
//
// Props:
//   product        — { shopify_product_id, title (or parent_title), image_url,
//                      category, vendor, selling_price, variants_summary, image_count }
//   onClose        — () => void
//   onPushed       — (result) => void   // called after successful push
// =====================================================================

import { useState, useEffect } from 'react';

const OCCASIONS = [
  { v: 'bridal',  l: 'Bridal' },
  { v: 'mehndi',  l: 'Mehndi' },
  { v: 'nikkah',  l: 'Nikkah' },
  { v: 'walima',  l: 'Walima' },
  { v: 'party',   l: 'Party' },
  { v: 'eid',     l: 'Eid' },
  { v: 'daily',   l: 'Daily wear' },
  { v: 'formal',  l: 'Formal' },
];

const CUSTOMERS = [
  { v: 'young_bride',      l: 'Young bride' },
  { v: 'mature_women',     l: 'Mature women' },
  { v: 'gift_buyer',       l: 'Gift buyer' },
  { v: 'family_function',  l: 'Family functions' },
];

const TONES = [
  { v: 'luxurious', l: 'Luxurious' },
  { v: 'warm',      l: 'Warm & personal' },
  { v: 'crisp',     l: 'Crisp & modern' },
];

export default function AiEnhanceModal({ product, onClose, onPushed }) {
  // ── Input state ──
  const [facts, setFacts] = useState('');
  const [occasions, setOccasions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [keywords, setKeywords] = useState('');
  const [tone, setTone] = useState('luxurious');

  // ── Flow state ──
  const [step, setStep] = useState('input'); // input | generating | output | pushing | pushed
  const [error, setError] = useState(null);

  // ── Output state ──
  const [enhancementId, setEnhancementId] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [costUsd, setCostUsd] = useState(0);

  // ── Editable output state ──
  const [selectedTitleIdx, setSelectedTitleIdx] = useState(0); // 0-2 from suggestions, -1 = keep current
  const [titleOverride, setTitleOverride] = useState('');
  const [descOverride, setDescOverride] = useState('');
  const [descEditMode, setDescEditMode] = useState(false);
  const [activeTags, setActiveTags] = useState([]);
  const [activeFaqs, setActiveFaqs] = useState([]);

  // ── Push field selection ──
  const [fieldsToPush, setFieldsToPush] = useState({
    title: false,          // default off — user explicitly opts in to title change
    description: true,
    meta_title: true,
    meta_description: true,
    url_handle: false,     // default off — handle changes break backlinks
    tags: true,
    alt_texts: true,
    faqs: true,
  });

  // ── Push result ──
  const [pushResult, setPushResult] = useState(null);

  // Escape key closes modal
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // When generation completes, seed editable states
  useEffect(() => {
    if (generated) {
      setTitleOverride(generated.title_suggestions?.[0]?.title || '');
      setDescOverride(generated.description_html || '');
      setActiveTags(generated.tags || []);
      setActiveFaqs(generated.faqs || []);
    }
  }, [generated]);

  const toggleChip = (list, setList, val) => {
    setList(list.includes(val) ? list.filter(x => x !== val) : [...list, val]);
  };

  // ── Generate ──
  const handleGenerate = async () => {
    setStep('generating');
    setError(null);
    try {
      const res = await fetch('/api/ai/enhance-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopify_product_id: product.shopify_product_id,
          product_title: product.title || product.parent_title,
          current_description: product.current_description || '',
          category: product.category,
          vendor: product.vendor,
          variants_summary: product.variants_summary || '',
          image_count: product.image_count || 5,
          selling_price: product.selling_price,
          input_facts: facts,
          input_occasions: occasions,
          input_customers: customers,
          input_keywords: keywords,
          input_tone: tone,
          input_language_mix: 'pure_english',
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Generation failed');
      }
      setEnhancementId(data.enhancement_id);
      setGenerated(data.generated);
      setCostUsd(data.cost_usd || 0);
      setStep('output');
    } catch (e) {
      setError(e.message);
      setStep('input');
    }
  };

  // ── Push to Shopify ──
  const handlePush = async () => {
    if (!enhancementId) return;
    setStep('pushing');
    setError(null);
    try {
      const res = await fetch('/api/ai/push-to-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enhancement_id: enhancementId,
          fields_to_push: {
            ...fieldsToPush,
            title_override: fieldsToPush.title
              ? (selectedTitleIdx === -1 ? (product.title || product.parent_title) : titleOverride)
              : null,
            description_override: descEditMode ? descOverride : null,
          },
        }),
      });
      const data = await res.json();
      setPushResult(data);
      if (data.success) {
        setStep('pushed');
        // Tell parent to refresh after a beat
        setTimeout(() => onPushed && onPushed(data), 500);
      } else {
        setError(data.error || 'Push failed');
        setStep('output');
      }
    } catch (e) {
      setError(e.message);
      setStep('output');
    }
  };

  // ── Styles (matching existing dark theme) ──
  const modalStyle = {
    position: 'fixed', inset: 0, zIndex: 300,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const panelStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    width: '100%', maxWidth: 1200, maxHeight: '92vh',
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
  };
  const columnsStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 0,
    flex: 1, minHeight: 0,
  };
  const colInput = {
    padding: 20,
    borderRight: '1px solid var(--border)',
    overflowY: 'auto',
    background: 'var(--bg2)',
  };
  const colOutput = {
    padding: 20,
    overflowY: 'auto',
    background: 'var(--bg)',
  };
  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 16,
  };
  const inputStyle = {
    width: '100%', padding: '10px 12px', background: 'var(--bg-card)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  };
  const chipStyle = (active) => ({
    padding: '6px 12px', fontSize: 12,
    background: active ? 'var(--gold-dim)' : 'transparent',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    borderRadius: 20,
    color: active ? 'var(--gold)' : 'var(--text2)',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s',
  });

  return (
    <div style={modalStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panelStyle}>

        {/* ══ Header ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
          borderBottom: '1px solid var(--border)', background: 'var(--bg2)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
        }}>
          {product.image_url && (
            <img src={product.image_url} alt="" style={{
              width: 44, height: 44, borderRadius: 6, objectFit: 'cover',
              border: '1px solid var(--border)',
            }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--gold)',
              textTransform: 'uppercase', letterSpacing: 2, marginBottom: 2,
            }}>
              ✨ AI Enhance
            </div>
            <div style={{
              fontSize: 16, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {product.title || product.parent_title}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'var(--text3)',
            fontSize: 26, cursor: 'pointer', padding: '0 8px',
          }}>×</button>
        </div>

        {/* ══ Body (2 columns) ══ */}
        <div style={columnsStyle}>

          {/* ─── LEFT: Inputs ─── */}
          <div style={colInput}>
            <div style={{
              fontSize: 13, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.5,
            }}>
              AI ko product ke baare mein bataiye. Jitna specific, utni accurate output.
            </div>

            <label style={labelStyle}>Quick Facts</label>
            <textarea
              value={facts}
              onChange={e => setFacts(e.target.value)}
              placeholder="e.g. kundan work, green enamel, bridal piece, ~180g, 24k gold plated, hand-set stones"
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />

            <label style={labelStyle}>Target Occasions</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {OCCASIONS.map(o => (
                <button key={o.v}
                  onClick={() => toggleChip(occasions, setOccasions, o.v)}
                  style={chipStyle(occasions.includes(o.v))}>
                  {o.l}
                </button>
              ))}
            </div>

            <label style={labelStyle}>Target Customer</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CUSTOMERS.map(c => (
                <button key={c.v}
                  onClick={() => toggleChip(customers, setCustomers, c.v)}
                  style={chipStyle(customers.includes(c.v))}>
                  {c.l}
                </button>
              ))}
            </div>

            <label style={labelStyle}>Target Keywords (optional)</label>
            <input type="text" value={keywords} onChange={e => setKeywords(e.target.value)}
              placeholder="e.g. green kundan choker, bridal necklace pakistan"
              style={inputStyle} />

            <label style={labelStyle}>Tone</label>
            <select value={tone} onChange={e => setTone(e.target.value)} style={inputStyle}>
              {TONES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>

            {/* Generate button */}
            <div style={{ marginTop: 24 }}>
              <button
                onClick={handleGenerate}
                disabled={step === 'generating' || step === 'pushing' || step === 'pushed'}
                style={{
                  width: '100%', padding: '12px 20px',
                  background: step === 'generating' ? 'var(--border)' : 'var(--gold)',
                  color: step === 'generating' ? 'var(--text3)' : '#080808',
                  border: 'none', borderRadius: 'var(--radius)',
                  fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
                  cursor: step === 'generating' ? 'wait' : 'pointer',
                  letterSpacing: 0.5,
                }}>
                {step === 'generating' ? '⟳ Generating...' :
                 generated ? '🔄 Regenerate' : '✨ Generate'}
              </button>

              {costUsd > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>
                  Cost: ${costUsd.toFixed(4)} (~Rs {(costUsd * 285).toFixed(1)})
                </div>
              )}
            </div>

            {error && (
              <div style={{
                marginTop: 16, padding: 12, borderRadius: 'var(--radius)',
                background: 'var(--red-dim)', border: '1px solid rgba(248,113,113,0.3)',
                color: 'var(--red)', fontSize: 12,
              }}>
                ⚠ {error}
              </div>
            )}
          </div>

          {/* ─── RIGHT: Output ─── */}
          <div style={colOutput}>
            {step === 'input' && !generated && (
              <EmptyOutputState />
            )}

            {step === 'generating' && (
              <GeneratingState />
            )}

            {generated && (
              <OutputView
                generated={generated}
                selectedTitleIdx={selectedTitleIdx}
                setSelectedTitleIdx={setSelectedTitleIdx}
                titleOverride={titleOverride}
                setTitleOverride={setTitleOverride}
                currentTitle={product.title || product.parent_title}
                descOverride={descOverride}
                setDescOverride={setDescOverride}
                descEditMode={descEditMode}
                setDescEditMode={setDescEditMode}
                activeTags={activeTags}
                setActiveTags={setActiveTags}
                activeFaqs={activeFaqs}
                setActiveFaqs={setActiveFaqs}
                fieldsToPush={fieldsToPush}
                setFieldsToPush={setFieldsToPush}
              />
            )}
          </div>
        </div>

        {/* ══ Footer ══ */}
        {generated && (
          <div style={{
            padding: '14px 20px', borderTop: '1px solid var(--border)',
            background: 'var(--bg2)', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center', gap: 12,
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {step === 'pushed'
                ? <span style={{ color: 'var(--green)' }}>✓ Pushed to Shopify successfully</span>
                : `${Object.values(fieldsToPush).filter(Boolean).length} fields selected to push`
              }
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{
                padding: '10px 18px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                color: 'var(--text2)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
              }}>
                {step === 'pushed' ? 'Close' : 'Cancel'}
              </button>
              {step !== 'pushed' && (
                <button
                  onClick={handlePush}
                  disabled={step === 'pushing' || Object.values(fieldsToPush).filter(Boolean).length === 0}
                  style={{
                    padding: '10px 22px',
                    background: step === 'pushing' ? 'var(--border)' : 'var(--green, #10b981)',
                    color: step === 'pushing' ? 'var(--text3)' : '#fff',
                    border: 'none', borderRadius: 'var(--radius)',
                    fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    cursor: step === 'pushing' ? 'wait' : 'pointer',
                    letterSpacing: 0.3,
                  }}>
                  {step === 'pushing' ? '⟳ Pushing...' : '→ Push to Shopify'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════

function EmptyOutputState() {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', color: 'var(--text3)',
      textAlign: 'center', padding: 40,
    }}>
      <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>✨</div>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8, color: 'var(--text2)' }}>
        Fill the inputs and click Generate
      </div>
      <div style={{ fontSize: 12, maxWidth: 320, lineHeight: 1.6 }}>
        AI will write: product description, title options, meta tags, image alt texts,
        FAQs for rich snippets, and SEO-optimized tags.
      </div>
    </div>
  );
}

function GeneratingState() {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, animation: 'spin 1.2s linear infinite', marginBottom: 16 }}>⟳</div>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>RS ZEVAR AI is writing...</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Usually 3-6 seconds</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── The main output display with all 9 sections ───
function OutputView({
  generated, selectedTitleIdx, setSelectedTitleIdx, titleOverride, setTitleOverride,
  currentTitle, descOverride, setDescOverride, descEditMode, setDescEditMode,
  activeTags, setActiveTags, activeFaqs, setActiveFaqs, fieldsToPush, setFieldsToPush,
}) {
  const toggleField = (k) => setFieldsToPush(f => ({ ...f, [k]: !f[k] }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* SEO Score */}
      {typeof generated.seo_score === 'number' && (
        <ScoreCard score={generated.seo_score} notes={generated.seo_notes} />
      )}

      {/* ── Title Suggestions ── */}
      <Section title="Title" icon="📝" pushKey="title" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <TitleOption
            active={selectedTitleIdx === -1}
            onClick={() => { setSelectedTitleIdx(-1); setTitleOverride(currentTitle); }}
            label="Keep current"
            text={currentTitle}
            reasoning=""
          />
          {(generated.title_suggestions || []).map((t, i) => (
            <TitleOption key={i}
              active={selectedTitleIdx === i}
              onClick={() => { setSelectedTitleIdx(i); setTitleOverride(t.title); }}
              label={`AI Option ${i + 1}`}
              text={t.title}
              reasoning={t.reasoning}
            />
          ))}
        </div>
        {selectedTitleIdx >= 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Edit selected title:</div>
            <input
              value={titleOverride}
              onChange={e => setTitleOverride(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                background: 'var(--bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 13,
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          </div>
        )}
      </Section>

      {/* ── Description ── */}
      <Section title="Description" icon="📄" pushKey="description" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={() => setDescEditMode(false)} style={miniBtnStyle(!descEditMode)}>👁 Preview</button>
          <button onClick={() => setDescEditMode(true)} style={miniBtnStyle(descEditMode)}>✎ Edit HTML</button>
        </div>
        {descEditMode ? (
          <textarea value={descOverride} onChange={e => setDescOverride(e.target.value)}
            rows={12}
            style={{
              width: '100%', padding: 10, boxSizing: 'border-box',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', color: 'var(--text)', fontSize: 12,
              fontFamily: 'monospace', outline: 'none', resize: 'vertical',
            }}
          />
        ) : (
          <div style={{
            padding: 14, background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', fontSize: 13, lineHeight: 1.6, color: 'var(--text2)',
            maxHeight: 320, overflowY: 'auto',
          }}
            dangerouslySetInnerHTML={{ __html: descOverride }} />
        )}
        <WordCount html={descOverride} />
      </Section>

      {/* ── Meta Title ── */}
      <Section title="Meta Title" icon="🏷️" pushKey="meta_title" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <CharCounterBox text={generated.meta_title} limits={[55, 60]} />
      </Section>

      {/* ── Meta Description ── */}
      <Section title="Meta Description" icon="📋" pushKey="meta_description" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <CharCounterBox text={generated.meta_description} limits={[150, 160]} />
      </Section>

      {/* ── URL Handle ── */}
      <Section title="URL Handle" icon="🔗" pushKey="url_handle" fieldsToPush={fieldsToPush} toggleField={toggleField}
        warning="⚠ Changing handle breaks existing backlinks & Google rankings. Only enable for new products.">
        <div style={{
          padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', fontSize: 12, fontFamily: 'monospace', color: 'var(--text2)',
        }}>
          rszevar.com/products/{generated.url_handle}
        </div>
      </Section>

      {/* ── Tags ── */}
      <Section title={`Tags (${activeTags.length})`} icon="🎯" pushKey="tags" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {activeTags.map((tag, i) => (
            <span key={i} style={{
              padding: '3px 10px', fontSize: 11,
              background: 'var(--gold-dim)', color: 'var(--gold)',
              border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              {tag}
              <button onClick={() => setActiveTags(t => t.filter((_, j) => j !== i))}
                style={{
                  background: 'none', border: 'none', color: 'var(--gold)',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
                }}>×</button>
            </span>
          ))}
        </div>
      </Section>

      {/* ── Alt Texts ── */}
      <Section title={`Image Alt Texts (${generated.alt_texts?.length || 0})`}
        icon="🖼️" pushKey="alt_texts" fieldsToPush={fieldsToPush} toggleField={toggleField}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(generated.alt_texts || []).map((a) => (
            <div key={a.position} style={{
              display: 'flex', gap: 8, padding: '6px 10px',
              background: 'var(--bg)', borderRadius: 4, fontSize: 12,
            }}>
              <span style={{ color: 'var(--text3)', fontWeight: 600, minWidth: 22 }}>#{a.position}</span>
              <span style={{ color: 'var(--text2)' }}>{a.alt}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── FAQs ── */}
      <Section title={`FAQs (${activeFaqs.length})`} icon="❓" pushKey="faqs" fieldsToPush={fieldsToPush} toggleField={toggleField}
        warning="Stored as metafield — display needs theme update to show in product page">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeFaqs.map((f, i) => (
            <div key={i} style={{
              padding: 10, background: 'var(--bg)', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', position: 'relative',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, paddingRight: 24 }}>
                {f.question}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{f.answer}</div>
              <button onClick={() => setActiveFaqs(faqs => faqs.filter((_, j) => j !== i))}
                style={{
                  position: 'absolute', top: 6, right: 8,
                  background: 'none', border: 'none', color: 'var(--text3)',
                  cursor: 'pointer', fontSize: 14, lineHeight: 1,
                }}>×</button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─── helpers ───

function Section({ title, icon, pushKey, fieldsToPush, toggleField, warning, children }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 14,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
          <span style={{ marginRight: 6 }}>{icon}</span>{title}
        </div>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
          color: 'var(--text3)', cursor: 'pointer',
        }}>
          <input type="checkbox" checked={!!fieldsToPush[pushKey]}
            onChange={() => toggleField(pushKey)} />
          Push to Shopify
        </label>
      </div>
      {children}
      {warning && (
        <div style={{
          marginTop: 8, fontSize: 10, color: 'var(--text3)',
          padding: '6px 8px', background: 'var(--bg)', borderRadius: 4,
          borderLeft: '2px solid var(--orange, #f59e0b)',
        }}>
          {warning}
        </div>
      )}
    </div>
  );
}

function TitleOption({ active, onClick, label, text, reasoning }) {
  return (
    <div onClick={onClick} style={{
      padding: 10, borderRadius: 'var(--radius)', cursor: 'pointer',
      border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
      background: active ? 'var(--gold-dim)' : 'var(--bg)',
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: active ? 'var(--gold)' : 'var(--text3)',
          textTransform: 'uppercase', letterSpacing: 1,
        }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{text.length} chars</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: reasoning ? 4 : 0 }}>{text}</div>
      {reasoning && <div style={{ fontSize: 10, color: 'var(--text3)', fontStyle: 'italic' }}>{reasoning}</div>}
    </div>
  );
}

function CharCounterBox({ text, limits = [150, 160] }) {
  const len = text?.length || 0;
  const [min, max] = limits;
  const color = len < min ? 'var(--orange, #f59e0b)' : len > max ? 'var(--red)' : 'var(--green)';
  return (
    <div>
      <div style={{
        padding: 10, background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text2)',
        lineHeight: 1.5,
      }}>{text}</div>
      <div style={{ textAlign: 'right', fontSize: 10, color, marginTop: 4, fontWeight: 600 }}>
        {len} / {max} chars {len < min && '(too short)'} {len > max && '(too long)'}
      </div>
    </div>
  );
}

function WordCount({ html }) {
  const plain = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = plain ? plain.split(' ').length : 0;
  const inRange = words >= 220 && words <= 280;
  return (
    <div style={{
      textAlign: 'right', fontSize: 10, marginTop: 4,
      color: inRange ? 'var(--green)' : 'var(--text3)', fontWeight: 600,
    }}>
      {words} words {inRange ? '✓' : '(target: 220-280)'}
    </div>
  );
}

function ScoreCard({ score, notes }) {
  const color = score >= 85 ? 'var(--green)' : score >= 70 ? 'var(--gold)' : 'var(--orange, #f59e0b)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: 14, background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{
        width: 50, height: 50, borderRadius: '50%',
        border: `3px solid ${color}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700, color,
      }}>
        {score}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
          SEO Score
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{notes}</div>
      </div>
    </div>
  );
}

function miniBtnStyle(active) {
  return {
    padding: '4px 10px', fontSize: 11,
    background: active ? 'var(--gold-dim)' : 'transparent',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    borderRadius: 'var(--radius)', color: active ? 'var(--gold)' : 'var(--text3)',
    cursor: 'pointer', fontFamily: 'inherit',
  };
}
