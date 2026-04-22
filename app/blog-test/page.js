'use client';

/**
 * /blog-test — Temporary test page for Phase 2 verification
 * Super simple form-based UI to test blog generation without Postman.
 * This will be replaced by proper /blog UI in Phase 3.
 */

import { useState } from 'react';

export default function BlogTestPage() {
  const [formData, setFormData] = useState({
    topic: 'Kundan vs Polki vs Meenakari: A Retailer\'s Identification Guide',
    keyword: 'kundan polki meenakari difference',
    article_type: 'guide',
    word_count_target: 2000,
    notes: 'Focus on how boutique retailers can educate customers. Include visual distinguishing features, price ranges in PKR, and which occasions each style suits best.',
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
        🧪 Blog Generation Test
      </h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Phase 2 verification page. Fill form, generate article, review, then push to Shopify Journal (draft).
      </p>

      <div style={{ background: '#f5f5f5', padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Topic *</label>
          <textarea
            style={inputStyle}
            rows={2}
            value={formData.topic}
            onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Target Keyword *</label>
          <input
            style={inputStyle}
            type="text"
            value={formData.keyword}
            onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Article Type</label>
            <select
              style={inputStyle}
              value={formData.article_type}
              onChange={(e) => setFormData({ ...formData, article_type: e.target.value })}
            >
              <option value="guide">Guide</option>
              <option value="listicle">Listicle</option>
              <option value="case_study">Case Study</option>
              <option value="news">News</option>
              <option value="pillar">Pillar</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Word Count Target</label>
            <input
              style={inputStyle}
              type="number"
              value={formData.word_count_target}
              onChange={(e) => setFormData({ ...formData, word_count_target: parseInt(e.target.value) })}
            />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea
            style={inputStyle}
            rows={3}
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            background: loading ? '#999' : '#000',
            color: 'white',
            padding: '10px 20px',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? `Generating... ${elapsedTime}s` : '🚀 Generate Article'}
        </button>
        {loading && (
          <p style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
            Claude Sonnet 4.6 likh raha hai... typically 30-60 seconds lagte hain.
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
          <strong style={{ color: '#060' }}>✅ Article Generated Successfully</strong>

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 13 }}>
            <Metric label="Word Count" value={result.metadata.word_count} />
            <Metric label="FAQ Count" value={result.metadata.faq_count} />
            <Metric label="Internal Links" value={result.metadata.internal_links} />
            <Metric label="Duration" value={`${Math.round(result.metadata.duration_ms / 1000)}s`} />
            <Metric label="Cost (USD)" value={`$${result.metadata.cost_usd}`} />
            <Metric label="Cost (PKR)" value={`Rs ${result.metadata.cost_pkr}`} />
          </div>

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
            <div
              style={{ background: 'white', padding: 20, borderRadius: 6, marginTop: 8, lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: result.post.body_html }}
            />
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
              <strong>Next step:</strong> If quality is good, push this draft to Shopify Journal blog.
              Shopify pe DRAFT mein jayega — publish manually karna hoga.
            </p>
            <button
              onClick={handlePushToShopify}
              disabled={pushLoading || result.post.status === 'pushed'}
              style={{
                marginTop: 10,
                background: pushLoading ? '#999' : '#059669',
                color: 'white',
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: pushLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {pushLoading ? 'Pushing to Shopify...' : '📤 Push to Shopify (as draft)'}
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
              <strong>Public URL (once published):</strong>{' '}
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
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#333',
  marginBottom: 4,
  textTransform: 'uppercase',
};

const inputStyle = {
  width: '100%',
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
