import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeInput } from '@/app/platform/_components/CodeInput';

// One real input: every keystroke carries the whole code in the input's own value,
// so a keystroke that lands before the parent re-renders cannot drop a digit.
function Harness({ onCode }: { onCode: (c: string) => void }) {
  const [v, setV] = useState('');
  return <CodeInput value={v} onChange={(c) => { setV(c); onCode(c); }} />;
}

describe('platform CodeInput', () => {
  it('is one labelled input that keeps digits only, six at most', () => {
    const onCode = jest.fn();
    render(<Harness onCode={onCode} />);
    const input = screen.getByLabelText('6-digit authenticator code');
    fireEvent.change(input, { target: { value: '12a 34-5678' } });
    expect(onCode).toHaveBeenLastCalledWith('123456');
    expect(input).toHaveValue('123456');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  });

  it('takes a formatted paste whole: no maxLength truncates it before the digit filter', () => {
    const onCode = jest.fn();
    render(<Harness onCode={onCode} />);
    const input = screen.getByLabelText('6-digit authenticator code');
    expect(input).not.toHaveAttribute('maxlength');
    fireEvent.change(input, { target: { value: '123 456' } });
    expect(onCode).toHaveBeenLastCalledWith('123456');
    fireEvent.change(input, { target: { value: '12 34-56' } });
    expect(onCode).toHaveBeenLastCalledWith('123456');
  });

  it('builds the code from the input, not from the last render', () => {
    const onChange = jest.fn();
    render(<CodeInput value="" onChange={onChange} />);
    // Parent never re-renders: the browser has already appended both keystrokes.
    fireEvent.change(screen.getByLabelText('6-digit authenticator code'), { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith('12');
  });

  it('draws six boxes showing the digits, hidden from assistive tech', () => {
    const { container } = render(<CodeInput value="42" onChange={() => {}} />);
    const boxes = container.querySelectorAll('[aria-hidden="true"] > div');
    expect(boxes).toHaveLength(6);
    expect(Array.from(boxes).map((b) => b.textContent)).toEqual(['4', '2', '', '', '', '']);
  });
});
