/**
 * SplitPane focus, pinned after QA on redesign/time (T2): below xl the pane
 * swap hid the focused element and dropped focus to <body> on every open,
 * back and decision, so keyboard and screen-reader users restarted from the
 * top of the document each time.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { InboxList, SplitPane } from '../src/components/ui';

type Item = { id: string; name: string };

function mockViewport(wide: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: wide && q.includes('min-width: 1280px'),
    media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function Inbox({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [sel, setSel] = useState<string | null>(null);
  const selected = items.find((i) => i.id === sel) ?? null;
  return (
    <SplitPane
      hasDetail={!!selected}
      onBack={() => setSel(null)}
      backLabel="Back to the queue"
      list={
        <InboxList
          items={items}
          itemKey={(i) => i.id}
          selectedKey={sel}
          onSelect={(i) => setSel(i.id)}
          render={(i) => <span>{i.name}</span>}
        />
      }
      detail={selected ? (
        <div>
          <h2>{selected.name}</h2>
          <button type="button" onClick={() => { setItems((l) => l.filter((x) => x.id !== selected.id)); setSel(null); }}>Approve</button>
        </div>
      ) : null}
    />
  );
}

const ITEMS: Item[] = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bala' }];
const row = (name: string) => screen.getByText(name).closest('[role="button"]') as HTMLElement;

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

describe('SplitPane below xl', () => {
  beforeEach(() => mockViewport(false));

  it('moves focus to the back control when a row opens the detail', () => {
    render(<Inbox initial={ITEMS} />);
    const r = row('Bala');
    r.focus();
    act(() => { fireEvent.keyDown(r, { key: 'Enter' }); });
    expect(document.activeElement).toBe(screen.getByText('Back to the queue').closest('button'));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('returns focus to the same row on back', () => {
    render(<Inbox initial={ITEMS} />);
    const r = row('Bala');
    r.focus();
    act(() => { fireEvent.keyDown(r, { key: 'Enter' }); });
    act(() => { fireEvent.click(screen.getByText('Back to the queue')); });
    expect(document.activeElement).toBe(row('Bala'));
  });

  it('falls back to the first remaining row when the decision removes the item', () => {
    render(<Inbox initial={ITEMS} />);
    const r = row('Bala');
    r.focus();
    act(() => { fireEvent.keyDown(r, { key: 'Enter' }); });
    const approve = screen.getByText('Approve');
    approve.focus();
    act(() => { fireEvent.click(approve); });
    expect(document.activeElement).toBe(row('Alice'));
  });
});

describe('SplitPane at xl', () => {
  beforeEach(() => mockViewport(true));

  it('leaves focus on the row when the detail opens beside it', () => {
    render(<Inbox initial={ITEMS} />);
    const r = row('Alice');
    r.focus();
    act(() => { fireEvent.keyDown(r, { key: 'Enter' }); });
    expect(document.activeElement).toBe(r);
  });

  it('recovers focus into the list when a decision unmounts the focused control', () => {
    render(<Inbox initial={ITEMS} />);
    act(() => { fireEvent.keyDown(row('Alice'), { key: 'Enter' }); });
    const approve = screen.getByText('Approve');
    approve.focus();
    act(() => { fireEvent.click(approve); });
    expect(document.activeElement).toBe(row('Bala'));
  });
});
