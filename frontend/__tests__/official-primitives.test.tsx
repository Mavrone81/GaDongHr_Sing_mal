/**
 * The five Official Record primitives.
 *
 * These replace the card as the vocabulary of the UI. Stage 2 hand-converts 74
 * screens onto them, so their behaviour is pinned here first — conversion should
 * be "use the component", never "invent the markup".
 */
import { render, screen } from '@testing-library/react';
import { Field, Seal, Button, DataTable, Notice } from '../src/components/official';

describe('Field — the basic unit', () => {
  it('renders label and value', () => {
    render(<Field label="Sick leave" value="30 days" />);
    expect(screen.getByText('Sick leave')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('renders the hint as secondary text', () => {
    render(<Field label="Sick leave" hint="Annual entitlement" value="30 days" />);
    expect(screen.getByText('Annual entitlement')).toBeInTheDocument();
  });

  it('renders an attached seal', () => {
    render(<Field label="Sick leave" value="14 days" seal={<Seal cite="EA s.89 · floor 14" />} />);
    expect(screen.getByText(/EA s\.89/)).toBeInTheDocument();
  });

  // Without tabular figures a column of money does not line up, and scanning
  // the column is the only reason it exists.
  it('renders values with tabular figures', () => {
    const { container } = render(<Field label="Net" value="24,025.00" />);
    expect(container.querySelector('.tabular-nums')).not.toBeNull();
  });
});

describe('Seal — the signature element', () => {
  it('prefixes the citation with a section mark', () => {
    render(<Seal cite="CPF Act s.7" />);
    expect(screen.getByText(/CPF Act s\.7/)).toBeInTheDocument();
    expect(screen.getByText('§')).toBeInTheDocument();
  });
});

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Approve</Button>);
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  /**
   * Hiding an action teaches the user the feature is missing; a server
   * rejection after clicking teaches them the product is unreliable. So a
   * blocked action stays visible with the reason beside it.
   */
  it('stays visible when disabled and shows the reason', () => {
    render(<Button disabled reason="Run already finalised">Approve</Button>);
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Run already finalised')).toBeInTheDocument();
  });
});

describe('DataTable — for anything with a total', () => {
  it('renders rows and a total', () => {
    render(
      <DataTable
        columns={[{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount', numeric: true }]}
        rows={[{ item: 'Base salary', amount: '24,000.00' }]}
        total={{ label: 'Net', value: '24,000.00' }}
      />,
    );
    expect(screen.getByText('Base salary')).toBeInTheDocument();
    expect(screen.getByText('Net')).toBeInTheDocument();
  });

  it('right-aligns numeric cells with tabular figures', () => {
    const { container } = render(
      <DataTable
        columns={[{ key: 'item', label: 'Item' }, { key: 'amount', label: 'Amount', numeric: true }]}
        rows={[{ item: 'Overtime', amount: '900.00' }]}
      />,
    );
    expect(container.querySelectorAll('td.tabular-nums').length).toBeGreaterThan(0);
  });
});

describe('Notice', () => {
  it('renders heading and body', () => {
    render(<Notice heading="Rejected — below statutory floor">Minimum is 7 days.</Notice>);
    expect(screen.getByText('Rejected — below statutory floor')).toBeInTheDocument();
    expect(screen.getByText('Minimum is 7 days.')).toBeInTheDocument();
  });

  /**
   * The notice border is INK, not seal red, even when it carries a citation.
   * The seal marks the authority; the notice is only a container. Using red for
   * both dilutes the reservation.
   */
  it('uses an ink border even when carrying a citation', () => {
    const { container } = render(
      <Notice heading="Rejected" seal={<Seal cite="EA s.43 · floor 7" />}>Below the floor.</Notice>,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toMatch(/border-ink/);
    expect(box.className).not.toMatch(/border-seal/);
  });
});
