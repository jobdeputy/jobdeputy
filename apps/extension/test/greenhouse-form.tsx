import { useState } from 'react';
import Select from 'react-select';

/**
 * A Greenhouse-shaped application form for the filler's tests, built with the same widget its
 * choice questions use (react-select, `select__` classes, the field's ID as input and instance
 * ID), so choosing is tested against the real thing. Race shows only after "Hispanic or
 * Latino: No", as on Greenhouse's self-ID section.
 */
const yesNo = ['Yes', 'No'];
const DECLINE = 'Decline To Self Identify';

function Choice({
  id,
  label,
  options,
  required = false,
  onPick,
}: {
  id: string;
  label: string;
  options: string[];
  required?: boolean;
  onPick?: (value: string) => void;
}) {
  return (
    <div className="field-wrapper">
      <div className="select__container">
        <label id={`${id}-label`} htmlFor={id} className="label select__label">
          {label}
          {required ? <span className="required">*</span> : null}
        </label>
        <Select
          inputId={id}
          instanceId={id}
          classNamePrefix="select"
          aria-labelledby={`${id}-label`}
          required={required}
          options={options.map((o) => ({ value: o, label: o }))}
          onChange={(option) => onPick?.(option?.value ?? '')}
        />
      </div>
    </div>
  );
}

function Text({ id, label, required = false }: { id: string; label: string; required?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <div className="field-wrapper">
      <label id={`${id}-label`} htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        className="input input__single-line"
        aria-required={required}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}

export function GreenhouseForm({ onResume }: { onResume?: (file: File | undefined) => void }) {
  const [hispanic, setHispanic] = useState('');
  return (
    <form id="application-form" className="application--form">
      <Text id="first_name" label="First Name" required />
      <Text id="last_name" label="Last Name" required />
      <Text id="email" label="Email" required />
      <Choice id="country" label="Country" options={['Canada +1', 'United States +1']} />
      <Text id="phone" label="Phone" />
      <div className="field-wrapper">
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: Greenhouse's own markup, copied as it is. */}
        {/* biome-ignore lint/a11y/useSemanticElements: Greenhouse's own markup, copied as it is. */}
        <div
          role="group"
          aria-labelledby="upload-label-resume"
          aria-required="true"
          className="file-upload"
        >
          <div id="upload-label-resume" className="label upload-label">
            Resume/CV<span className="required">*</span>
          </div>
          <label className="visually-hidden" htmlFor="resume">
            Attach
          </label>
          <input id="resume" type="file" onChange={(e) => onResume?.(e.target.files?.[0])} />
        </div>
      </div>
      <Text id="question_1" label="LinkedIn Profile" />
      <Choice
        id="question_2"
        label="Are you legally authorized to work in the United States?"
        options={yesNo}
        required
      />
      <Choice
        id="question_3"
        label="Will you now or in the future require sponsorship?"
        options={['No', 'Yes, H-1B']}
        required
      />
      <Choice
        id="question_4"
        label="Have you previously worked at Acme?"
        options={yesNo}
        required
      />
      <Text id="question_5" label="Why Acme?" required />
      <Choice id="gender" label="Gender" options={['Male', 'Female', DECLINE]} />
      <Choice
        id="hispanic_ethnicity"
        label="Are you Hispanic/Latino?"
        options={['Yes', 'No', DECLINE]}
        onPick={setHispanic}
      />
      {hispanic === 'No' ? (
        <Choice id="race" label="Please identify your race" options={['Asian', 'White', DECLINE]} />
      ) : null}
    </form>
  );
}
