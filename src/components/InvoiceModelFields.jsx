function Field({ label, children }) {
  return <div className="form-group"><label className="form-label">{label}</label>{children}</div>
}

function Input({ name, value, update, ...props }) {
  return <input className="form-control" name={name} value={value ?? ''} onChange={update} {...props} />
}

export default function InvoiceModelFields({ form, update }) {
  if (form.model === 'joining_percentage') return <><Field label="CTC"><Input name="ctc_lpa" value={form.ctc_lpa} update={update} inputMode="decimal" /></Field><Field label="Percent Value"><Input name="model_percent" value={form.model_percent} update={update} inputMode="decimal" /></Field></>
  if (form.model === 'joining_flat_fee') return <Field label="Flat Fee (₹)"><Input name="model_flat_fee" value={form.model_flat_fee} update={update} inputMode="decimal" /></Field>
  if (form.model === 'retainer') return <Field label="Retainer Amount (₹)"><Input name="retainer_amount" value={form.retainer_amount} update={update} inputMode="decimal" /></Field>
  if (form.model === 'project') return <Field label="Project Amount (₹)"><Input name="project_amount" value={form.project_amount} update={update} inputMode="decimal" /></Field>
  if (form.model === 'jra_adjustment_percentage') return <><Field label="CTC"><Input name="ctc_lpa" value={form.ctc_lpa} update={update} inputMode="decimal" /></Field><Field label="Percent Value"><Input name="model_percent" value={form.model_percent} update={update} inputMode="decimal" /></Field><Field label="Adjustment Value (₹)"><Input name="jra_adjustment_value" value={form.jra_adjustment_value} update={update} inputMode="decimal" /></Field></>
  if (form.model === 'jra_adjustment_flat_fee') return <><Field label="Value (₹)"><Input name="jra_base_value" value={form.jra_base_value} update={update} inputMode="decimal" /></Field><Field label="Flat Fee / Adjustment (₹)"><Input name="jra_flat_fee" value={form.jra_flat_fee} update={update} inputMode="decimal" /></Field></>
  return <Field label="Amount (₹)"><Input name="others_amount" value={form.others_amount} update={update} inputMode="decimal" /></Field>
}
