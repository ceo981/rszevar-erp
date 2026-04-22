'use client';

/**
 * /blog-test — v3 with link validation + image preview + catalog stats
 */

import { useState } from 'react';

export default function BlogTestPage() {
  const [formData, setFormData] = useState({
    topic: 'Kundan vs Zircon vs Turkish Jewelry: A Buyer\'s Complete Guide',
    keyword: 'kundan vs zircon vs turkish jewelry',
    article_type: 'guide',
    word_count_target: 1800,
    notes: 'Compare the three jewelry styles that RS ZEVAR specializes in. Include identification tips, occasion suitability, price ranges in PKR, and care instructions. Target both boutique retailers and end customers.',
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setPushResult(null);
    setElapsedTime(0);

    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    try {
      const response = await fetch('/api/blog/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      clearInterval(timer);

      if (!response.ok) {
        setError(data.error + (data.details ? `: ${data.details}` : ''));
      } else {
        setResult(data);
      }
    } catch (err) {
      clearInterval(timer);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePushToShopify = async () => {
    if (!result?.post?.id) return;
    setPushLoading(true);
    setPushResult(null);
    try {
      const response = await fetch('/api/blog/push-to-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: result.post.id, publish_immediately: false }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPushResult({ error: data.error + (data.details ? `: ${data.details}` : '') });
      } else {
        setPushResult(data);
      }
    } catch (err) {
      setPushResult({ error: err.message });
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        🧪 Blog Generation Test <span style={{ fontSize: 14, color: '#059669', fontWeight: 500 }}>v3 — Smart Linking</span>
      </h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Now uses REAL collection slugs + bestseller products from Supabase catalog. No more fake URLs.
      </p>

      <div style={{ background: '#f5f5f5', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Topic *</label>
          <textarea style={inputStyle} rows={2} value={formData.topic}
            onChange={(e) => setFormData({ ...formData, topic: e.target.value })} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Target Keyword *</label>
          <input style={inputStyle} type="text" value={formData.keyword}
            onChange={(e) => setFormData({ ...formData, keyword: e.target.value })} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Article Type</label>
            <select style={inputStyle} value={formData.article_type}
              onChange={(e) => setFormData({ ...formData, article_type: e.target.value })}>
              <option value="guide">Guide</option>
              <option value="listicle">Listicle</option>
              <option value="case_study">Case Study</option>
              <option value="news">News</option>
              <option value="pillar">Pillar</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Word Count Target</label>
            <input style={inputStyle} type="number" value={formData.word_count_target}
              onChange={(e) => setFormData({ ...formData, word_count_target: parseInt(e.target.value) })} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea style={inputStyle} rows={3} value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
        </div>

        <button onClick={handleGenerate} disabled={loading}
          style={{
            background: loading ? '#999' : '#000', color: 'white',
            padding: '10px 20px', border: 'none', borderRadius: 6,
            fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          }}>
          {loading ? `Generating... ${elapsedTime}s` : '🚀 Generate Article (Smart Links)'}
        </button>
        {loading && (
          <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Fetching catalog → Claude Sonnet 4.6 writing → 40-100s typical
          </p>
        )}
      </div>

      {error && (
        <div style={{ background: '#fee', border: '1px solid #f88', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <strong style={{ color: '#c00' }}>❌ Error:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 8 }}>{error}</pre>
        </div>
      )}

      {result?.success && (
        <div style={{ background: '#efe', border: '1px solid #8f8', padding: 16, borderRadius: 8, marginBottom: 16 }}>
          <strong style={{ color: '#060' }}>✅ Article Generated</strong>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13 }}>
            <Metric label="Word Count" value={result.metadata.word_count} />
            <Metric label="FAQ Count" value={result.metadata.faq_count} />
            <Metric label="Internal Links" value={result.metadata.internal_links} />
            <Metric label="Duration" value={`${Math.round(result.metadata.duration_ms / 1000)}s`} />
            <Metric label="Cost (USD)" value={`$${result.metadata.cost_usd}`} />
            <Metric label="Cost (PKR)" value={`Rs ${result.metadata.cost_pkr}`} />
          </div>

          {result.catalog_used && (
            <div style={{ marginTop: 12, padding: 10, background: '#eff6ff', borderRadius: 6, fontSize: 13 }}>
              <strong>📚 Catalog used:</strong> {result.catalog_used.collections} collections, {result.catalog_used.products} bestseller products
            </div>
          )}

          {result.link_validation && (
            <div style={{
              marginTop: 12, padding: 12,
              background: result.link_validation.all_valid ? '#d1fae5' : '#fee2e2',
              border: result.link_validation.all_valid ? '1px solid #10b981' : '1px solid #ef4444',
              borderRadius: 6, fontSize: 13,
            }}>
              <strong>
                {result.link_validation.all_valid ? '🔗 ✅ All Links Valid!' : '⚠️ Some Invalid Links Detected'}
              </strong>
              <p style={{ margin: '6px 0 4px 0' }}>
                Valid: {result.link_validation.valid_links.length} | Invalid: {result.link_validation.invalid_links.length} | Total: {result.link_validation.total}
              </p>
              {result.link_validation.valid_links.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12 }}>Show valid links</summary>
                  <ul style={{ fontSize: 12, marginTop: 4, paddingLeft: 20 }}>
                    {result.link_validation.valid_links.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </details>
              )}
              {result.link_validation.invalid_links.length > 0 && (
                <details open style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#991b1b' }}>⚠️ Invalid links (will 404!)</summary>
                  <ul style={{ fontSize: 12, marginTop: 4, paddingLeft: 20, color: '#991b1b' }}>
                    {result.link_validation.invalid_links.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #ccc' }} />

          <h2 style={{ fontSize: 20, margin: '8px 0' }}>{result.post.title}</h2>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
            <strong>Slug:</strong> /blogs/journal/{result.post.slug}
          </p>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
            <strong>Meta Title ({result.post.meta_title.length}/70):</strong> {result.post.meta_title}
          </p>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
            <strong>Meta Description ({result.post.meta_description.length}/160):</strong> {result.post.meta_description}
          </p>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
            <strong>Excerpt:</strong> {result.post.excerpt}
          </p>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            <strong>Tags:</strong> {Array.isArray(result.post.tags) ? result.post.tags.join(', ') : ''}
          </p>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              📖 Read Full Article Body (click to expand)
            </summary>
            <div style={{ background: 'white', padding: 20, borderRadius: 6, marginTop: 8, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: result.post.body_html }} />
          </details>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              ❓ FAQs ({result.post.faqs?.length || 0})
            </summary>
            <div style={{ background: 'white', padding: 16, borderRadius: 6, marginTop: 8 }}>
              {(result.post.faqs || []).map((faq, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Q: {faq.question}</p>
                  <p style={{ color: '#444', fontSize: 14 }}>A: {faq.answer}</p>
                </div>
              ))}
            </div>
          </details>

          <div style={{ marginTop: 20, padding: 12, background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6 }}>
            <p style={{ margin: 0, fontSize: 13, color: '#92400e' }}>
              <strong>Next step:</strong> {result.link_validation?.all_valid
                ? 'All links valid! Safe to push.'
                : '⚠️ Fix invalid links before pushing (regenerate or edit manually).'}
            </p>
            <button onClick={handlePushToShopify}
              disabled={pushLoading || result.post.status === 'pushed'}
              style={{
                marginTop: 10,
                background: pushLoading ? '#999' : (result.link_validation?.all_valid ? '#059669' : '#f59e0b'),
                color: 'white', padding: '8px 16px', border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 600,
                cursor: pushLoading ? 'not-allowed' : 'pointer',
              }}>
              {pushLoading ? 'Pushing...' : '📤 Push to Shopify (as draft)'}
            </button>
          </div>
        </div>
      )}

      {pushResult?.error && (
        <div style={{ background: '#fee', border: '1px solid #f88', padding: 16, borderRadius: 8 }}>
          <strong style={{ color: '#c00' }}>❌ Shopify Push Error:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 8 }}>{pushResult.error}</pre>
        </div>
      )}

      {pushResult?.success && (
        <div style={{ background: '#dbeafe', border: '1px solid #60a5fa', padding: 16, borderRadius: 8 }}>
          <strong style={{ color: '#1e40af' }}>✅ Pushed to Shopify</strong>
          <p style={{ fontSize: 13, marginTop: 8, marginBottom: 8 }}>{pushResult.message}</p>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <p style={{ margin: '4px 0' }}>
              <strong>Shopify Admin:</strong>{' '}
              <a href={pushResult.shopify.admin_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                Open in Shopify
              </a>
            </p>
            <p style={{ margin: '4px 0' }}>
              <strong>Public URL:</strong>{' '}
              <a href={pushResult.shopify.public_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
                {pushResult.shopify.public_url}
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ background: 'white', padding: 8, borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#333',
  marginBottom: 4, textTransform: 'uppercase',
};

const inputStyle = {
  width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4,
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};
