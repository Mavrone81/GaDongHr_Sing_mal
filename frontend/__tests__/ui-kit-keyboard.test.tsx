/**
 * Keyboard behaviour of the redesign kit, pinned after QA found two defects:
 *  - DataTable's clickable row swallowed Enter/Space and clicks aimed at
 *    controls nested inside it (a Suspend button, a date input), so those
 *    controls could not be operated and the row navigated instead.
 *  - Modal let Tab leave the dialog into the page under the backdrop.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Avatar, DataTable, Modal, SplitPane, Tabs } from '../src/components/ui';

type Row = { id: string; name: string };
const ROWS: Row[] = [{ id: 'a', name: 'Acme' }];

function table(onRowClick: jest.Mock, onAction: jest.Mock) {
  return render(
    <DataTable<Row>
      rows={ROWS}
      rowKey={(r) => r.id}
      onRowClick={onRowClick}
      columns={[
        { key: 'name', label: 'Name', render: (r) => r.name },
        { key: 'act', label: 'Action', render: () => <button type="button" onClick={onAction}>Suspend</button> },
      ]}
    />,
  );
}

describe('DataTable clickable rows', () => {
  it('activates the row on Enter and Space aimed at the row itself', () => {
    const onRow = jest.fn();
    table(onRow, jest.fn());
    const row = screen.getAllByRole('button').find((el) => el.getAttribute('tabindex') === '0')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onRow).toHaveBeenCalledTimes(2);
  });

  it('leaves Enter and clicks on a nested control to that control', () => {
    const onRow = jest.fn();
    const onAction = jest.fn();
    table(onRow, onAction);
    const action = screen.getByText('Suspend');
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('opens the row when a plain cell is clicked', () => {
    const onRow = jest.fn();
    table(onRow, jest.fn());
    fireEvent.click(screen.getByText('Acme'));
    expect(onRow).toHaveBeenCalledTimes(1);
  });
});

describe('Modal focus trap', () => {
  it('cycles Tab and Shift+Tab inside the dialog', () => {
    render(
      <>
        <button type="button">Outside</button>
        <Modal open onClose={() => {}} title="Add company" footer={<button type="button">Save</button>}>
          <input aria-label="Name" />
        </Modal>
      </>,
    );
    const close = screen.getByLabelText('Close');
    const save = screen.getByText('Save');
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it('pulls focus back in when it has escaped the dialog', () => {
    render(
      <>
        <button type="button">Outside</button>
        <Modal open onClose={() => {}} title="Add company">
          <input aria-label="Name" />
        </Modal>
      </>,
    );
    screen.getByText('Outside').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByLabelText('Close'));
  });
});

describe('Tabs roving focus', () => {
  function Harness() {
    const [t, setT] = useState<'a' | 'b' | 'c'>('a');
    return <Tabs items={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]} active={t} onChange={setT} />;
  }
  it('moves focus with selection on ArrowRight / ArrowLeft', () => {
    render(<Harness />);
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Gamma' }));
  });
});

describe('Avatar', () => {
  it('never renders initials below 12px', () => {
    render(<Avatar name="Tan Wei" size={24} />);
    expect(parseFloat((screen.getByTitle('Tan Wei') as HTMLElement).style.fontSize)).toBeGreaterThanOrEqual(12);
  });
});

describe('Nested Modals', () => {
  it('Escape closes only the topmost dialog', () => {
    const closeOuter = jest.fn();
    const closeInner = jest.fn();
    render(
      <Modal open onClose={closeOuter} title="Pending profiles">
        <Modal open onClose={closeInner} title="Review">
          <p>Inner</p>
        </Modal>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();
  });
});

describe('SplitPane focus (narrow screens)', () => {
  function Inbox({ removeOnApprove = false }: { removeOnApprove?: boolean }) {
    const [items, setItems] = useState(['a', 'b']);
    const [sel, setSel] = useState<string | null>(null);
    return (
      <SplitPane
        hasDetail={sel !== null}
        onBack={() => setSel(null)}
        list={<ul>{items.map((i) => <li key={i}><button type="button" onClick={() => setSel(i)}>Row {i}</button></li>)}</ul>}
        detail={<div><h2>Detail {sel}</h2><button type="button" onClick={() => { if (removeOnApprove) setItems((l) => l.filter((x) => x !== sel)); setSel(null); }}>Approve</button></div>}
      />
    );
  }

  beforeAll(() => {
    // jsdom has no layout: report a narrow viewport.
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  });

  it('moves focus into the detail when a row opens it', () => {
    render(<Inbox />);
    const row = screen.getByText('Row a');
    row.focus();
    fireEvent.click(row);
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Details' }));
  });

  it('returns focus to the opening row on Back', () => {
    render(<Inbox />);
    const row = screen.getByText('Row b');
    row.focus();
    fireEvent.click(row);
    const back = screen.getByText('Back to list');
    back.focus();
    fireEvent.click(back);
    expect(document.activeElement).toBe(screen.getByText('Row b'));
  });

  it('falls back to the list when the opening row is gone after Approve', () => {
    render(<Inbox removeOnApprove />);
    const row = screen.getByText('Row a');
    row.focus();
    fireEvent.click(row);
    const approve = screen.getByText('Approve');
    approve.focus();
    fireEvent.click(approve);
    expect(screen.queryByText('Row a')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.contains(screen.getByText('Row b'))).toBe(true);
  });
});
