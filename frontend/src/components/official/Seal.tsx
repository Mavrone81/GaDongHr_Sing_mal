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
  return (
    <span
      className="inline-flex items-center gap-1 border border-seal text-seal rounded-[2px]
                 px-1 py-[0.05rem] font-mono text-[0.5625rem] tracking-[0.04em] uppercase align-middle"
    >
      <span aria-hidden="true">§</span>
      {cite}
    </span>
  );
}
