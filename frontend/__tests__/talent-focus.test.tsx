/**
 * redesign/talent — focus on the in-page detail views (QA TL1).
 *
 * Offboarding's case screen and training's course player replace the list in
 * place rather than opening a dialog, so nothing moved focus: a keyboard or
 * screen-reader user was left on <body> and had to Tab back through the whole
 * sidebar to reach what they had just opened. These tests drive the real pages
 * with mocked APIs and assert where focus lands on the way in and on the way out.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });

const CASE = {
  id: 'c1', employeeId: 'e1', employeeName: 'Tan Wei Ming', department: 'Engineering', reason: 'END_OF_CONTRACT',
  lastWorkingDate: '2026-10-30', noticeGivenDate: '2026-09-30', isForeignEmployee: false, status: 'IN_PROGRESS',
  createdAt: '2026-09-30', clearanceItems: [{ id: 'i1', itemName: 'Return laptop', isDone: false }],
};

const PROGRAM = {
  id: 'p1', title: 'Workplace safety basics', category: 'SAFETY', status: 'PUBLISHED', isMandatory: true, createdBy: 'u', createdAt: '2026-09-01',
  materials: [{ id: 'm1', programId: 'p1', title: 'Read the handbook', type: 'DOCUMENT', orderIndex: 0, content: 'Wear a helmet.' }],
};
const ENROLMENT = { id: 'en1', programId: 'p1', employeeId: 'me', status: 'IN_PROGRESS', progress: 0, enrolledAt: '2026-09-02', program: PROGRAM, materialProgress: [] };

jest.mock('@/lib/api', () => ({
  apiFetchRaw: jest.fn((path: string) => {
    if (path === '/offboarding') return json([CASE]);
    if (path === '/offboarding/c1') return json(CASE);
    // Resolves a tick later, as in production: the case lands while the view is
    // still loading its assets. (Resolving both at once hid a bug where the
    // heading was looked for before it existed.)
    if (path === '/assets/employee/e1') return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve([]) }), 30));
    return json({});
  }),
  apiFetch: jest.fn((path: string) => {
    if (path === '/training/my-programs') return Promise.resolve([ENROLMENT]);
    if (path.startsWith('/training/programs?') || path === '/training/programs') return Promise.resolve([{ ...PROGRAM, id: 'p2', title: 'Fire drill', enrollments: [] }]);
    if (path.endsWith('/self-enroll')) return Promise.resolve({});
    return Promise.resolve({});
  }),
}));

jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'EMPLOYEE', name: 'Ana Lim' }, loading: false }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OffboardingPage = require('@/app/(dashboard)/offboarding/page').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TrainingPage = require('@/app/(dashboard)/training/page').default;

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  if (!window.requestAnimationFrame) (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
});

describe('offboarding case view', () => {
  it('focuses the case heading on open and the opening row on the way back', async () => {
    const { container } = render(<OffboardingPage />);
    await screen.findAllByText('Tan Wei Ming');
    const row = container.querySelector<HTMLElement>('[role="table"] [role="button"]')!;
    row.focus();
    fireEvent.click(row);

    const heading = await screen.findByRole('heading', { level: 1, name: 'Tan Wei Ming' });
    await waitFor(() => expect(document.activeElement).toBe(heading));

    fireEvent.click(screen.getByRole('button', { name: /All cases/ }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('sentence-cases a reason the label map does not know', async () => {
    render(<OffboardingPage />);
    expect((await screen.findAllByText(/End of contract/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/END_OF_CONTRACT/)).toBeNull();
  });
});

describe('training course player', () => {
  it('focuses the course title on open and the card that opened it on the way back', async () => {
    const { container } = render(<TrainingPage />);
    await screen.findByText('Continue learning');
    const opener = container.querySelector<HTMLElement>('[data-open-enrollment="en1"]')!;
    opener.focus();
    fireEvent.click(opener);

    const title = await screen.findByRole('heading', { level: 2, name: 'Workplace safety basics' });
    await waitFor(() => expect(document.activeElement).toBe(title));

    fireEvent.click(screen.getByRole('button', { name: /Back to my training/ }));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute('data-open-enrollment')).toBe('en1'));
  });

  it('hands focus to My training after self-enrolling from Browse', async () => {
    render(<TrainingPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Browse programmes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enrol' }));
    const panel = await screen.findByRole('region', { name: 'My training' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(document.activeElement).toBe(panel));
  });
});
