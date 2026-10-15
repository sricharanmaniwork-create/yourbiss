import type { BlockNode, PageTree } from '@/lib/blocks/types';
import { containerStyle, renderBlock, type RenderContext } from '@/lib/blocks/render';
import { isContainer } from '@/lib/blocks/tree';

/**
 * The published page walker. It only lays out containers and delegates every
 * block's innards to the shared renderer, which is what the builder's canvas
 * calls too — so an edited block and a live block cannot disagree.
 *
 * `section`, `navbar` and `footer` are full-bleed; anything else sitting
 * directly on the page is constrained to the theme's content width.
 */

const FULL_BLEED = new Set<string>(['section', 'navbar', 'footer']);

function Stack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: '16px', alignItems: 'start' }}>{children}</div>;
}

function EmptyContainer() {
  return (
    <div
      style={{
        minHeight: '56px',
        border: '1px dashed color-mix(in srgb, currentColor 22%, transparent)',
        borderRadius: '8px',
        opacity: 0.55,
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      Empty
    </div>
  );
}

function BlockAt({ node, ctx }: { node: BlockNode; ctx: RenderContext }) {
  if (!isContainer(node.type)) {
    const body = renderBlock(node, ctx);
    if (body === null) return null;
    return <div className="site-block">{body}</div>;
  }

  const { outer, inner } = containerStyle(node, ctx);
  const kids = node.children.length === 0 ? <EmptyContainer /> : <Stack>{node.children.map((child) => <BlockAt key={child.id} node={child} ctx={ctx} />)}</Stack>;

  if (node.type === 'section') {
    return (
      <section className="site-block" style={outer}>
        <div style={inner}>{kids}</div>
      </section>
    );
  }

  return (
    <div className="site-block" style={outer}>
      {kids}
    </div>
  );
}

export function SiteTree({ tree, ctx }: { tree: PageTree; ctx: RenderContext }) {
  return (
    <>
      {tree.children.map((node) =>
        FULL_BLEED.has(node.type) ? (
          <BlockAt key={node.id} node={node} ctx={ctx} />
        ) : (
          <div
            key={node.id}
            style={{ maxWidth: ctx.theme.max_width ?? '1200px', margin: '0 auto', paddingInline: '24px', width: '100%' }}
          >
            <BlockAt node={node} ctx={ctx} />
          </div>
        ),
      )}
    </>
  );
}
