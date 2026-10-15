'use client';

/**
 * Only reached when the root layout itself fails — an unrenderable `<html>` is
 * the one case where Next requires a self-contained boundary. It deliberately
 * carries no shared components, since those depend on the layout that broke.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f4f5f7', color: '#111827', font: '14px/1.5 Inter, system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ maxWidth: 480, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '28px 30px' }}>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Yourbiss could not start</h1>
            <p style={{ marginTop: 10, fontSize: 13, color: '#6b7280' }}>
              Something failed before the page could render. The usual cause is a missing environment variable.
            </p>
            <pre
              style={{
                marginTop: 12,
                padding: '8px 10px',
                background: '#fafbfc',
                border: '1px solid #e5e7eb',
                borderRadius: 6,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error.message}
            </pre>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 16,
                height: 36,
                padding: '0 16px',
                background: '#2e6be6',
                color: '#fff',
                border: 0,
                borderRadius: 6,
                font: '500 13.5px Inter, system-ui, sans-serif',
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
