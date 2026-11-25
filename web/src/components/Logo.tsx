// Marca do otp-out: uma chave saindo de uma caixa. Não é um QR.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M9 9h8M9 9v14h14v-6"
        className="stroke-primary-foreground"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="11" r="3.2" className="stroke-primary-foreground" fill="none" strokeWidth="2.5" />
      <path d="M18.8 13.2 14 18m1.2-3.6 1.6 1.6" className="stroke-primary-foreground" fill="none" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
