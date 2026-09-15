/**
 * Keyboard behaviour of the redesign kit, pinned after QA found two defects:
 *  - DataTable's clickable row swallowed Enter/Space and clicks aimed at
 *    controls nested inside it (a Suspend button, a date input), so those
 *    controls could not be operated and the row navigated instead.
 *  - Modal let Tab leave the dialog into the page under the backdrop.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable, Modal } from '../src/components/ui';

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
