/**
 * A citation attached to any value an external authority sets.
 *
 * ⚠ THIS IS THE ONLY COMPONENT PERMITTED TO USE THE SEAL TOKEN.
 *
 * The reservation is enforced by frontend/__tests__/seal-reservation.test.ts,
 * because the source design document watched this exact rule erode within hours
 * of being written down. The instant seal red marks an error, a delete button
 * or a validation failure, the citation stops reading as special and the whole
 * language collapses into decoration.
 *
 * In GaDongHR the authorities are Singapore's CPF Act and Employment Act, and
 * Malaysia's EPF/SOCSO/EIS Acts — never Thailand's LPA, which belongs to
 * GaDong's separate Thai product.
 */
export function Seal({ cite }: { cite: string }) {
  // 2026-09 redesign: 12px, the citation's own case (no forced caps), so the
  // one element that carries legal weight is also readable.
  return (
    <span
      className="inline-flex items-center gap-1 border border-seal text-seal rounded
                 px-1.5 py-px font-mono text-xs leading-[1.4] align-middle whitespace-nowrap"
    >
      <span aria-hidden="true">§</span>
      {cite}
    </span>
  );
}
