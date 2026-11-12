import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const MOVE: KeyframeAnimationOptions = { duration: 220, easing: 'ease-in-out' }
const FADE_MS = 200
const STAGGER_MS = 25
const MAX_STAGGER_MS = 200

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A `view-transition-name` for something identified by free text, such as a path.
 * Names must be CSS identifiers, so the text is hashed rather than escaped.
 */
export function transitionName(prefix: string, text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i)
  return `${prefix}-${(hash >>> 0).toString(36)}`
}

interface MotionItem<T> {
  item: T
  /** Already removed from the list, shown only while it fades out where it was. */
  leaving: boolean
}

/**
 * Keeps a list continuous as it changes: items slide from where they were to where
 * they are, new ones fade in, and removed ones fade out in place instead of vanishing.
 * Render `items` from the result, put `ref` on their parent, and mark each child with
 * `data-motion-key` (plus `data-leaving` and `inert` when leaving).
 */
export function useListMotion<T>(list: T[], keyOf: (item: T) => string) {
  const ref = useRef<HTMLDivElement>(null)
  const tops = useRef<Map<string, number> | null>(null)
  // Compared by keys, not array identity: callers often build a fresh array every render.
  const order = list.map(keyOf).join('\n')
  const [previous, setPrevious] = useState({ list, order })
  const [leaving, setLeaving] = useState<Array<{ item: T; index: number }>>([])

  // Derived during render, so the removed items are in the very commit that drops
  // them and nothing flashes out for a frame.
  if (order !== previous.order) {
    setPrevious({ list, order })
    if (!reducedMotion()) {
      const kept = new Set(list.map(keyOf))
      const gone = previous.list.flatMap((item, index) =>
        kept.has(keyOf(item)) ? [] : [{ item, index }],
      )
      const stillGone = leaving.filter((g) => !kept.has(keyOf(g.item)))
      if (gone.length > 0 || stillGone.length !== leaving.length) {
        setLeaving([...stillGone, ...gone])
      }
    }
  }

  useEffect(() => {
    if (leaving.length === 0) return
    const timer = setTimeout(() => setLeaving([]), FADE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  const items: MotionItem<T>[] = list.map((item) => ({ item, leaving: false }))
  for (const { item, index } of leaving) {
    items.splice(Math.min(index, items.length), 0, { item, leaving: true })
  }

  useLayoutEffect(() => {
    const nodes = ref.current?.querySelectorAll<HTMLElement>(':scope > [data-motion-key]')
    if (!nodes) return
    const before = tops.current
    const animate = before !== null && !reducedMotion()
    const after = new Map<string, number>()
    let entering = 0

    for (const node of nodes) {
      const key = node.dataset.motionKey as string
      after.set(key, node.offsetTop)
      if (!animate) continue

      if (node.dataset.leaving !== undefined) {
        if (node.getAnimations().length === 0) {
          node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: 'forwards' })
        }
        continue
      }
      const top = before.get(key)
      if (top === undefined) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: FADE_MS,
          delay: Math.min(entering++ * STAGGER_MS, MAX_STAGGER_MS),
          easing: 'ease-out',
          fill: 'backwards',
        })
        continue
      }
      const dy = top - node.offsetTop
      if (dy !== 0) {
        node.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], MOVE)
      }
    }
    tops.current = after
  }, [order, leaving])

  return { ref, items }
}
