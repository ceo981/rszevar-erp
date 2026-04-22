/**
 * Shopify Blog REST API wrapper
 * Handles blog ID fetching and article push to Shopify Journal
 *
 * Env var support (checks in this order):
 * - SHOPIFY_ACCESS_TOKEN (RS ZEVAR convention — PRIMARY)
 * - SHOPIFY_ADMIN_ACCESS_TOKEN (generic standard — fallback)
 *
 * - SHOPIFY_STORE_DOMAIN (RS ZEVAR convention — PRIMARY)
 * - SHOPIFY_SHOP_DOMAIN (generic — fallback)
 */

const SHOPIFY_API_VERSION = '2024-01';

function getShopifyDomain() {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ||
    process.env.SHOPIFY_SHOP_DOMAIN ||
    'rszevar.myshopify.com';
  
  // Strip https:// prefix if present
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function getShopifyBaseUrl() {
  return `https://${getShopifyDomain()}/admin/api/${SHOPIFY_API_VERSION}`;
}

function getShopifyHeaders() {
  const token =
    process.env.SHOPIFY_ACCESS_TOKEN ||
    process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  
  if (!token) {
    throw new Error(
      'Shopify access token missing. Set SHOPIFY_ACCESS_TOKEN in Vercel env vars.'
    );
  }
  
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
}

/**
 * Fetch the Journal blog ID from Shopify
 * Cached in memory after first call
 */
let _cachedBlogId = null;
let _cachedBlogHandle = null;

export async function getJournalBlogId() {
  if (_cachedBlogId) return _cachedBlogId;

  const url = `${getShopifyBaseUrl()}/blogs.json`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getShopifyHeaders(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to fetch blogs from Shopify: ${response.status} ${response.statusText} — ${errText}`);
  }

  const data = await response.json();
  const blogs = data.blogs || [];

  if (blogs.length === 0) {
    throw new Error('No blogs found on Shopify store. Create one in Shopify Admin → Content → Blog posts → Manage blogs.');
  }

  // Prefer blog with handle 'journal', fallback to first blog
  const journal = blogs.find((b) => b.handle === 'journal') || blogs[0];
  _cachedBlogId = journal.id;
  _cachedBlogHandle = journal.handle;

  console.log(`[shopify-blog] Using blog: ${journal.title} (ID: ${journal.id}, handle: ${journal.handle})`);
  return _cachedBlogId;
}

/**
 * Push a blog post to Shopify as a DRAFT article
 */
export async function pushBlogPostToShopify(blogPost) {
  const blogId = await getJournalBlogId();
  const url = `${getShopifyBaseUrl()}/blogs/${blogId}/articles.json`;

  const articlePayload = {
    article: {
      title: blogPost.title,
      author: blogPost.author_name || 'Abdul Rehman',
      body_html: appendFaqsToBody(blogPost.body_html, blogPost.faqs),
      summary_html: blogPost.excerpt ? `<p>${escapeHtml(blogPost.excerpt)}</p>` : undefined,
      tags: Array.isArray(blogPost.tags) ? blogPost.tags.join(', ') : '',
      published: false, // Always start as draft
      metafields: [
        {
          namespace: 'global',
          key: 'title_tag',
          value: blogPost.meta_title,
          type: 'single_line_text_field',
        },
        {
          namespace: 'global',
          key: 'description_tag',
          value: blogPost.meta_description,
          type: 'single_line_text_field',
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getShopifyHeaders(),
    body: JSON.stringify(articlePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify article push failed: ${response.status} ${response.statusText} — ${errorText}`);
  }

  const data = await response.json();
  const article = data.article;

  const domain = getShopifyDomain();
  const storeHandle = domain.replace('.myshopify.com', '');
  const blogHandle = _cachedBlogHandle || 'journal';

  return {
    shopify_article_id: article.id,
    shopify_blog_id: blogId,
    shopify_handle: article.handle,
    admin_url: `https://admin.shopify.com/store/${storeHandle}/content/blogs/${blogId}/articles/${article.id}`,
    public_url: `https://rszevar.com/blogs/${blogHandle}/${article.handle}`,
    shopify_status: article.published_at ? 'published' : 'draft',
  };
}

/**
 * Update an existing Shopify article
 */
export async function updateShopifyArticle(blogId, articleId, blogPost) {
  const url = `${getShopifyBaseUrl()}/blogs/${blogId}/articles/${articleId}.json`;

  const articlePayload = {
    article: {
      id: articleId,
      title: blogPost.title,
      author: blogPost.author_name || 'Abdul Rehman',
      body_html: appendFaqsToBody(blogPost.body_html, blogPost.faqs),
      summary_html: blogPost.excerpt ? `<p>${escapeHtml(blogPost.excerpt)}</p>` : undefined,
      tags: Array.isArray(blogPost.tags) ? blogPost.tags.join(', ') : '',
    },
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: getShopifyHeaders(),
    body: JSON.stringify(articlePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify article update failed: ${response.status} — ${errorText}`);
  }

  return await response.json();
}

/**
 * Append FAQ section to body_html
 */
function appendFaqsToBody(bodyHtml, faqs) {
  if (!Array.isArray(faqs) || faqs.length === 0) return bodyHtml;

  const faqHtml = `
<h2>Frequently Asked Questions</h2>
<div class="rszevar-faq-section">
${faqs
  .map(
    (faq) => `  <div class="rszevar-faq-item">
    <h3>${escapeHtml(faq.question)}</h3>
    <p>${escapeHtml(faq.answer)}</p>
  </div>`
  )
  .join('\n')}
</div>`;

  return bodyHtml + faqHtml;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
