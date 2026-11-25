import { CircleHelpIcon } from "lucide-react";
import { useI18n } from "@/i18n";

/** Texto com trechos entre crases mostrados como código. Não interpreta HTML. */
function WithCode({ text }: { text: string }) {
  return text.split("`").map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded border bg-muted px-1 py-px font-mono text-[0.9em] [overflow-wrap:anywhere] [box-decoration-break:clone]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

// Perguntas frequentes em títulos e parágrafos simples, sempre visíveis, para o
// texto inteiro estar no HTML estático que buscadores e IAs leem sem JavaScript.
export function FaqSection() {
  const { m } = useI18n();
  return (
    <section aria-labelledby="perguntas" className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6 xl:col-span-2" data-testid="faq">
      <h2 id="perguntas" className="flex items-center gap-2 text-xl font-semibold">
        <CircleHelpIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {m.faqTitle}
      </h2>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        {m.faq.map((item) => (
          <div key={item.q} className="flex max-w-[68ch] flex-col gap-1.5">
            <h3 className="font-semibold text-balance">{item.q}</h3>
            <p className="text-[0.95rem]">
              <WithCode text={item.a} />
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
