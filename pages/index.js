import { useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import { getAllPosts } from '../lib/posts';

export default function Home({ allPosts }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [downloadPreparing, setDownloadPreparing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const handleDownload = async (e) => {
    e.preventDefault();

    if (loading || !url.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);
    setDownloadPreparing(false);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: url.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(
          data.error || 'Unable to process this video.'
        );
      }

      /*
       * Parse.js returns the real Bilibili video URL directly as
       * videoUrl - the download button builds its own /api/direct-download
       * link from this at click time.
       */

      const videoUrl = data.videoUrl || '';

      if (!videoUrl) {
        throw new Error(
          'No downloadable video was found.'
        );
      }

      setResult({
        ...data,
        videoUrl,
      });

    } catch (err) {
      setError(
        err.message || 'Something went wrong.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();

      if (text) {
        setUrl(text.trim());
      }
    } catch (error) {
      console.error('Paste failed:', error);
    }
  };

  /*
   * Download button handler - uses a background job + polling flow.
   * yt-dlp downloads+merges to a complete file first (with its own retry
   * logic for network hiccups), then we stream that finished file. This
   * is what reliably downloaded full, correct videos in testing - the
   * direct ffmpeg-streaming approach was truncating longer videos.
   */
  const handleVideoDownload = async () => {
    if (!result?.videoUrl) return;

    setDownloadPreparing(true);
    setDownloadProgress(0);
    setError('');

    try {
      const startRes = await fetch('/api/start-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: result.videoUrl, title: result.title || 'Bilibili Video' }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error || 'Could not start download.');
      }

      const jobId = startData.jobId;

      // Poll every 2s until the job is done or errors out (up to ~5 min).
      const maxAttempts = 150;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(`/api/job-status?id=${jobId}`);
        const statusData = await statusRes.json();
        setDownloadProgress(statusData.progress || 0);

        if (statusData.status === 'done') {
          const link = document.createElement('a');
          link.href = `/api/job-file?id=${jobId}`;
          link.download = `${result.title || 'Bilibili Video'}.mp4`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setDownloadPreparing(false);
          return;
        }

        if (statusData.status === 'error') {
          throw new Error(statusData.message || 'Download failed.');
        }
        // status === 'processing' or 'merging' -> keep polling
      }

      throw new Error('Download is taking too long. Please try again.');
    } catch (err) {
      setError(err.message || 'Something went wrong while downloading.');
      setDownloadPreparing(false);
    }
  };

  /*
   * Display file size when Parse.js provides it.
   */
  const formatFileSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '';

    const size = Number(bytes);

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    if (size < 1024 * 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const videoSize =
    result?.filesize ||
    result?.fileSize ||
    result?.filesize_approx ||
    result?.size ||
    0;

  return (
    <Layout>

      {/* =========================
          HERO SECTION
      ========================== */}

      <section className="hero-section">

        <div
          className="container"
          style={{ maxWidth: '640px' }}
        >

          <div className="badge-tag">
            <span>🔥</span> Fast & Free Bilibili Downloader
          </div>

          <h1 className="hero-title">
            Download Bilibili Videos <br />
            <span className="title-accent">
              in HD Quality
            </span>
          </h1>

          <p className="hero-desc">
            Paste your Bilibili link below to instantly
            extract and download your favorite videos,
            anime, and clips without watermark.
          </p>


          {/* =========================
              INPUT FORM
          ========================== */}

          <form
            onSubmit={handleDownload}
            className="input-card"
          >

            <div className="input-group">

              <input
                type="text"
                placeholder="Paste Bilibili link here (bilibili.com or b23.tv)..."
                value={url}
                onChange={(e) =>
                  setUrl(e.target.value)
                }
              />

              <button
                type="button"
                onClick={handlePaste}
                className="paste-btn"
              >
                📋 Paste
              </button>

            </div>


            <button
              type="submit"
              className="btn-main"
              disabled={loading}
              style={{
                opacity: loading ? 0.8 : 1,
                cursor: loading
                  ? 'wait'
                  : 'pointer',
              }}
            >

              {loading
                ? '⏳ Preparing Download...'
                : 'Download Now 🚀'}

            </button>

          </form>


          {/* =========================
              PARSING / LOADING MESSAGE
          ========================== */}

          {loading && (

            <div
              style={{
                marginTop: '18px',
                padding: '18px 20px',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '14px',
                textAlign: 'left',
                boxShadow:
                  '0 6px 20px rgba(0,0,0,0.04)',
              }}
            >

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '8px',
                }}
              >

                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    border:
                      '3px solid #e2e8f0',
                    borderTop:
                      '3px solid #ff0844',
                    borderRadius: '50%',
                    animation:
                      'biliSpin 0.8s linear infinite',
                    flexShrink: 0,
                  }}
                />

                <strong
                  style={{
                    fontSize: '0.95rem',
                    color: '#0f172a',
                  }}
                >
                  Preparing your video...
                </strong>

              </div>


              <p
                style={{
                  margin: 0,
                  fontSize: '0.82rem',
                  color: '#64748b',
                  lineHeight: '1.5',
                }}
              >
                We're finding the fastest available
                download. Please don't close this page.
              </p>

            </div>

          )}


          {/* =========================
              ERROR
          ========================== */}

          {error && (

            <div
              style={{
                marginTop: '16px',
                color: '#ff0844',
                background: '#fff1f2',
                padding: '12px',
                borderRadius: '12px',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              {error}
            </div>

          )}


          {/* =========================
              RESULT CARD
          ========================== */}

          {result && (

            <div
              style={{
                marginTop: '24px',
                background: '#fff',
                padding: '20px',
                borderRadius: '16px',
                border:
                  '1px solid #e2e8f0',
                textAlign: 'left',
                display: 'flex',
                gap: '16px',
                alignItems: 'center',
              }}
            >

              {/* Thumbnail */}

              {result.thumbnail && (

                <img
                  src={`/api/thumbnail?url=${encodeURIComponent(
                    result.thumbnail
                  )}`}
                  alt="Thumbnail"
                  style={{
                    width: '120px',
                    height: '75px',
                    objectFit: 'cover',
                    borderRadius: '8px',
                    flexShrink: 0,
                  }}
                />

              )}


              <div
                style={{
                  flex: 1,
                  overflow: 'hidden',
                }}
              >

                {/* Title */}

                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    marginBottom: '6px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {result.title ||
                    'Bilibili Video'}
                </h3>


                {/* Video Size */}

                {videoSize && (

                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#64748b',
                      marginBottom: '10px',
                      fontWeight: 600,
                    }}
                  >
                    📦 Size: {formatFileSize(videoSize)}
                  </div>

                )}


                {/* Download Button */}

                {result.videoUrl && (

                  <button
                    type="button"
                    onClick={handleVideoDownload}
                    style={{
                      display: 'inline-block',
                      background: '#10b981',
                      color: '#fff',
                      padding: '9px 16px',
                      borderRadius: '8px',
                      fontWeight: 750,
                      border: 'none',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    Download MP4 📥
                  </button>

                )}


                {/* =========================
                    DOWNLOAD PREPARING TEXT
                ========================== */}

                {downloadPreparing && (

                  <div
                    style={{
                      marginTop: '10px',
                      padding: '10px 12px',
                      background: '#f0fdf4',
                      border:
                        '1px solid #bbf7d0',
                      borderRadius: '9px',
                      color: '#15803d',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      lineHeight: '1.4',
                    }}
                  >

                    ⏳ Downloading... {Math.round(downloadProgress)}%
                    <div
                      style={{
                        marginTop: '6px',
                        height: '6px',
                        width: '100%',
                        background: '#dcfce7',
                        borderRadius: '99px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(4, Math.round(downloadProgress))}%`,
                          background: '#22c55e',
                          borderRadius: '99px',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>

                    <span
                      style={{
                        fontWeight: 500,
                        color: '#64748b',
                      }}
                    >
                      {downloadProgress >= 100 ? 'Finalizing video, almost done...' : "Don't close this page."}
                    </span>

                  </div>

                )}

              </div>

            </div>

          )}


          {/* =========================
              TRUST BAR
          ========================== */}

          <div className="trust-bar">

            <span className="trust-item">
              ⚡ Ultra Fast
            </span>

            <span className="trust-item">
              🛡️ 100% Secure
            </span>

            <span className="trust-item">
              ✨ No Registration
            </span>

          </div>

        </div>

      </section>


      {/* =========================
          HOW TO DOWNLOAD
      ========================== */}

      <section
        className="howto-section"
        style={{
          paddingBottom: '30px',
        }}
      >

        <div
          className="container"
          style={{
            maxWidth: '920px',
          }}
        >

          <div
            style={{
              textAlign: 'center',
              marginBottom: '32px',
            }}
          >

            <div
              className="eyebrow"
              style={{
                background:
                  'rgba(255, 8, 68, 0.08)',
                color: '#ff0844',
                border:
                  '1px solid rgba(255, 8, 68, 0.15)',
              }}
            >
              SIMPLE STEPS
            </div>

            <h2 className="howto-main-title">
              How to Download Bilibili Videos
            </h2>

            <p className="howto-subtitle">
              Follow these 3 easy steps to save
              any video instantly.
            </p>

          </div>


          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '20px',
            }}
          >

            {/* Step 1 */}

            <div
              className="howto-card"
              style={{
                padding: '32px 24px',
                alignItems: 'flex-start',
                textAlign: 'left',
              }}
            >

              <div
                className="howto-badge"
                style={{
                  marginBottom: '14px',
                }}
              >
                1
              </div>

              <h3
                className="howto-step-title"
style={{
                  fontSize: '1.15rem',
                  marginBottom: '8px',
                }}
              >
                Copy Video Link
              </h3>

              <p
                className="howto-step-desc"
                style={{
                  fontSize: '0.9rem',
                  margin: 0,
                }}
              >
                Open the Bilibili app or website,
                choose the video you want to
                download, and copy its share link
                or URL from the address bar.
              </p>

            </div>


            {/* Step 2 */}

            <div
              className="howto-card"
              style={{
                padding: '32px 24px',
                alignItems: 'flex-start',
                textAlign: 'left',
              }}
            >

              <div
                className="howto-badge"
                style={{
                  marginBottom: '14px',
                }}
              >
                2
              </div>

              <h3
                className="howto-step-title"
                style={{
                  fontSize: '1.15rem',
                  marginBottom: '8px',
                }}
              >
                Paste into Downloader
              </h3>

              <p
                className="howto-step-desc"
                style={{
                  fontSize: '0.9rem',
                  margin: 0,
                }}
              >
                Return to Bili Save, paste your
                copied link into the input box
                at the top of the page, and click
                the download button.
              </p>

            </div>


            {/* Step 3 */}

            <div
              className="howto-card"
              style={{
                padding: '32px 24px',
                alignItems: 'flex-start',
                textAlign: 'left',
              }}
            >

              <div
                className="howto-badge"
                style={{
                  marginBottom: '14px',
                }}
              >
                3
              </div>

              <h3
                className="howto-step-title"
                style={{
                  fontSize: '1.15rem',
                  marginBottom: '8px',
                }}
              >
                Save & Enjoy
              </h3>

              <p
                className="howto-step-desc"
                style={{
                  fontSize: '0.9rem',
                  margin: 0,
                }}
              >
                Tap Download MP4 to save the
                video directly to your device.
              </p>

            </div>

          </div>

        </div>

      </section>


      {/* =========================
          BLOG SECTION
      ========================== */}

      <section
        className="featured-article-section"
        style={{
          padding: '20px 16px 70px',
        }}
      >

        <div
          className="container"
          style={{
            maxWidth: '920px',
          }}
        >

          <div
            style={{
              textAlign: 'center',
              marginBottom: '36px',
            }}
          >

            <div
              className="eyebrow"
              style={{
                background:
                  'rgba(255, 8, 68, 0.08)',
                color: '#ff0844',
                border:
                  '1px solid rgba(255, 8, 68, 0.15)',
              }}
            >
              FROM THE BLOG
            </div>

            <h2 className="howto-main-title">
              Guides & Articles
            </h2>

            <p className="howto-subtitle">
              Everything you need to know about
              video streaming and formats.
            </p>

          </div>


          <div
            className="post-list"
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '24px',
            }}
          >

            {allPosts.map((post, index) => {

              const gradients = [
                'linear-gradient(135deg, #ff0844 0%, #ff4e50 100%)',
                'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                'linear-gradient(135deg, #3b82f6 0%, #4f46e5 100%)',
                'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              ];

              const cardBg =
                post.gradient ||
                gradients[index % gradients.length];

              return (

                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="post-card"
                  style={{
                    borderRadius: '24px',
                    background: '#ffffff',
                    border:
                      '1px solid rgba(226, 232, 240, 0.9)',
                    boxShadow:
                      '0 10px 30px -5px rgba(0, 0, 0, 0.05)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    textDecoration: 'none',
                  }}
                >

                  <div
                    className="post-thumb"
                    style={{
                      background: cardBg,
                      height: '140px',
                      position: 'relative',
                    }}
                  >

                    <div
                      className="thumb-visual"
                      style={{
                        padding: '16px 20px',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >

                      <div
                        className="thumb-top-row"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >

                        {post.category ? (

                          <span
                            className="thumb-tag"
                            style={{
                              background:
                                'rgba(255, 255, 255, 0.22)',
                              backdropFilter:
                                'blur(8px)',
                              border:
                                '1px solid rgba(255, 255, 255, 0.35)',
                              color: '#fff',
                              fontWeight: '800',
                              fontSize: '0.65rem',
                              padding: '4px 10px',
                              borderRadius: '99px',
                              textTransform: 'uppercase',
                            }}
                          >
                            {post.category}
                          </span>

                        ) : (
                          <span />
                        )}


                        <div
                          className="thumb-icon-badge"
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            background:
                              'rgba(255, 255, 255, 0.25)',
                            border:
                              '1px solid rgba(255, 255, 255, 0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >

                          <span
                            style={{
                              fontSize: '1.2rem',
                              lineHeight: 1,
                            }}
                          >
                            {post.emoji || '📄'}
                          </span>

                        </div>

                      </div>


                      {post.tagline && (

                        <div className="thumb-heading">

                          <p
                            className="thumb-title"
                            style={{
                              fontSize: '0.9rem',
                              color: '#fff',
                              fontWeight: '700',
                              textShadow:
                                '0 2px 4px rgba(0,0,0,0.2)',
                            }}
                          >
                            {post.tagline}
                          </p>

                        </div>

                      )}

                    </div>

                  </div>


                  <div
                    className="post-card-body"
                    style={{
                      padding:
                        '20px 22px 22px',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                    }}
                  >

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >

                      <span
                        className="post-date"
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: '700',
                          color: '#94a3b8',
                          textTransform: 'uppercase',
                        }}
                      >
                        {new Date(
                          post.date
                        ).toLocaleDateString(
                          'en-US',
                          {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          }
                        )}
                      </span>


                      {post.readingTime && (
                        <>
                          <span
                            style={{
                              color: '#cbd5e1',
                            }}
                          >
                            •
                          </span>

                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: '700',
                              color: '#94a3b8',
                            }}
                          >
                            {post.readingTime}
                          </span>
                        </>
                      )}

                    </div>


                    <h3
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: '800',
                        color:
                          'var(--text-main)',
                        marginBottom: '8px',
                        lineHeight: '1.35',
                      }}
                    >
                      {post.title}
                    </h3>


                    <p
                      style={{
                        fontSize: '0.9rem',
                        color:
                          'var(--text-muted)',
                        lineHeight: '1.55',
                        marginBottom: '16px',
                        flex: 1,
                        display:
                          '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient:
                          'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {post.excerpt}
                    </p>


                    <div
                      style={{
                        paddingTop: '12px',
                        borderTop:
                          '1px solid #f1f5f9',
                      }}
                    >

                      <span
                        className="post-read-more"
                        style={{
                          color: '#ff0844',
                          fontWeight: '800',
                          fontSize: '0.85rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        Read full article →
                      </span>

                    </div>

                  </div>

                </Link>

              );

            })}

          </div>

        </div>

      </section>


      {/* =========================
          FAQ SECTION
      ========================== */}

      <section className="faq-section">

        <div
          className="container"
          style={{
            maxWidth: '920px',
          }}
        >

          <div
            style={{
              textAlign: 'center',
              marginBottom: '32px',
            }}
          >

            <div
              className="eyebrow"
              style={{
                background:
                  'rgba(255, 8, 68, 0.08)',
                color: '#ff0844',
                border:
                  '1px solid rgba(255, 8, 68, 0.15)',
              }}
            >
              HELP CENTER
            </div>

            <h2 className="howto-main-title">
              Frequently Asked Questions
            </h2>

            <p className="howto-subtitle">
              Got questions about downloading
              from Bilibili? We've got answers.
            </p>

          </div>


          <div className="faq-list">

            <FaqItem
              question="Is Bili Save completely free to use?"
              answer="Yes! Bili Save is 100% free with no hidden charges, subscription walls, or download limits."
            />

            <FaqItem
              question="Do I need to install any app or extension?"
              answer="No installation required. You can download videos directly from your web browser on Android, iPhone, PC, or Mac."
            />

            <FaqItem
              question="Where are the downloaded videos saved?"
              answer="Videos are saved directly into your device's default Downloads folder automatically."
            />

            <FaqItem
              question="Can I download videos in 1080p or 4K?"
              answer="Yes, depending on the source quality uploaded on Bilibili, the downloader extracts the highest available HD resolution."
            />

          </div>

        </div>

      </section>

    </Layout>
  );
}


/* =========================
   FAQ ITEM
========================= */

function FaqItem({ question, answer }) {

  const [isOpen, setIsOpen] =
    useState(false);

  return (

    <div
      className={`faq-item ${
        isOpen ? 'faq-open' : ''
      }`}
    >

      <button
        className="faq-question"
        onClick={() =>
          setIsOpen(!isOpen)
        }
      >

        <span>{question}</span>

        <svg
          width="20"
          height="20"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{
            transform: isOpen
              ? 'rotate(180deg)'
              : 'rotate(0deg)',
            transition:
              'transform 0.2s ease',
          }}
        >

          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />

        </svg>

      </button>


      {isOpen && (

        <div className="faq-answer">
          {answer}
        </div>

      )}

    </div>

  );
}


/* =========================
   STATIC PROPS
========================= */

export async function getStaticProps() {

  const allPosts =
    getAllPosts();

  return {
    props: {
      allPosts,
    },
  };
                }
