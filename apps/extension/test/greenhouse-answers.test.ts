import { describe, expect, it } from 'vitest';
import { answerFor, type Question, type Want } from '../src/greenhouse/answers.ts';
import { fillData } from './greenhouse-data.ts';

const text = (id: string, label = id): Question => ({ id, label, kind: 'text' });
const choice = (id: string, label = id): Question => ({ id, label, kind: 'choice' });

/** The option a choice picks among these, or null. */
function picked(want: Want | null, options: string[]): string | null {
  if (want?.kind !== 'choice') throw new Error(`not a choice: ${JSON.stringify(want)}`);
  const index = want.pick(options);
  return index === null ? null : (options[index] ?? null);
}
const value = (want: Want | null) => (want?.kind === 'text' ? want.value : want);

describe('answerFor (#54 PR C)', () => {
  const data = fillData();

  it("fills the form's own fields from the profile", () => {
    expect(value(answerFor(text('first_name', 'First Name'), data))).toBe('Sam');
    expect(value(answerFor(text('last_name'), data))).toBe('Example');
    expect(value(answerFor(text('email'), data))).toBe('sam@example.com');
    expect(value(answerFor(text('phone'), data))).toBe('+1 555 0100');
    expect(answerFor({ id: 'resume', label: 'Resume/CV', kind: 'file' }, data)).toEqual({
      kind: 'file',
      file: data.resume,
    });
    expect(answerFor({ id: 'cover_letter', label: 'Cover Letter', kind: 'file' }, data)).toBeNull();
    expect(picked(answerFor(choice('country'), data), ['Canada', 'United States +1'])).toBe(
      'United States +1',
    );
  });

  it("answers each company's questions by what they ask", () => {
    const ask = (label: string) => answerFor(text('question_1', label), data);
    expect(value(ask('LinkedIn Profile'))).toBe('https://www.linkedin.com/in/sam');
    expect(value(ask('GitHub URL'))).toBe('https://github.com/sam');
    expect(value(ask("What's the name you'd prefer us to use throughout the interview?"))).toBe(
      'Sammy',
    );
    expect(value(ask('Your pronouns'))).toBe('they/them');
    expect(value(ask('What are your salary expectations?'))).toBe('$150,000–$180,000 per year');
    expect(value(ask('What is your notice period?'))).toBe('2 weeks');
    expect(value(ask('When can you start?'))).toBe('January 4, 2027');
  });

  it('answers yes/no only with a plain Yes or No option', () => {
    const ask = (label: string, options: string[]) =>
      picked(answerFor(choice('question_2', label), data), options);
    expect(ask('Are you legally authorized to work in the United States?', ['Yes', 'No'])).toBe(
      'Yes',
    );
    expect(ask('Will you now or in the future require sponsorship?', ['No', 'Yes, H-1B'])).toBe(
      'No',
    );
    expect(ask('Are you at least 18 years of age?', ['Yes.', 'No.'])).toBe('Yes.');
    expect(ask('Are you willing to relocate?', ['Yes', 'No'])).toBe('No');
    // More than one option could be the answer, or none plainly is: left for the person.
    expect(ask('Are you willing to relocate?', ['No', 'No, but open to it'])).toBe('No');
    expect(ask('Are you willing to relocate?', ['Maybe', 'Not now'])).toBeNull();
  });

  it('never answers work authorization for a country with no saved answer', () => {
    const ask = (label: string) => answerFor(choice('question_3', label), data);
    expect(ask('Are you authorized to work in Germany?')).toBeNull();
    expect(ask('Do you need sponsorship to work in the United Kingdom?')).toBeNull();
    expect(
      picked(ask('Are you authorized to work in the country where this job is?'), ['Yes', 'No']),
    ).toBe('Yes');
    const sponsorshipNeeded = fillData({
      applicant: {
        workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: true }],
        workSetups: [],
      },
    });
    const visa = answerFor(
      choice('question_4', 'Will you require visa sponsorship?'),
      sponsorshipNeeded,
    );
    // "Yes" plainly isn't among them: which visa is the person's to say.
    expect(picked(visa, ['No', 'Yes, Blue Card', 'Yes, H-1B'])).toBeNull();
  });

  it('reads "authorized without sponsorship" as both, never as the sponsorship question', () => {
    const ask = (label: string, d = data) =>
      picked(answerFor(choice('question_11', label), d), ['Yes', 'No']);
    expect(
      ask('Are you legally authorized to work in the United States without sponsorship?'),
    ).toBe('Yes');
    expect(ask('Are you eligible to work in the U.S. without the need for visa sponsorship?')).toBe(
      'Yes',
    );
    const needsVisa = fillData({
      applicant: {
        workAuthorization: [{ country: 'US', authorized: true, needsSponsorship: true }],
        workSetups: [],
      },
    });
    expect(ask('Are you authorized to work in the US without sponsorship?', needsVisa)).toBe('No');
    expect(ask('Will you require sponsorship?', needsVisa)).toBe('Yes');
    // Both asked at once: which to answer is the person's call.
    expect(
      answerFor(
        choice('question_12', 'Are you authorized to work here, and will you need sponsorship?'),
        data,
      ),
    ).toBeNull();
  });

  it('knows short names for places, so a question about one never gets the US answer', () => {
    const ask = (label: string) => answerFor(choice('question_13', label), data);
    for (const label of [
      'Are you authorized to work in the UK?',
      'Do you have the right to work in the EU?',
      'Are you authorized to work in the UAE?',
      'Are you authorized to work in England or the US?',
    ]) {
      expect(ask(label), label).toBeNull();
    }
    expect(picked(ask('Are you authorized to work in the U.S.?'), ['Yes', 'No'])).toBe('Yes');
    expect(picked(ask('Are you authorized to work in the USA?'), ['Yes', 'No'])).toBe('Yes');
    // "us" is a word, not a country.
    expect(picked(ask('Are you legally authorized to work for us?'), ['Yes', 'No'])).toBe('Yes');
  });

  it('never puts a link into a question that only names a site as an example', () => {
    expect(
      answerFor(
        text('question_14', 'How did you hear about this role (e.g. LinkedIn, referral)?'),
        data,
      ),
    ).toBeNull();
  });

  it('chooses how they heard only when one option says it', () => {
    const heard = answerFor(choice('question_5', 'How did you hear about us?'), data);
    expect(picked(heard, ['Company website', 'LinkedIn', 'Referral'])).toBe('LinkedIn');
    expect(picked(heard, ['LinkedIn post', 'LinkedIn job ad'])).toBeNull();
  });

  it('fills self-ID only from saved answers, worded as US forms word them', () => {
    const options = {
      gender: ['Male', 'Female', 'Decline To Self Identify'],
      hispanic_ethnicity: ['Yes', 'No', 'Decline To Self Identify'],
      race: [
        'American Indian or Alaskan Native',
        'Asian',
        'Black or African American',
        'Hispanic or Latino',
        'White',
        'Native Hawaiian or Other Pacific Islander',
        'Two or More Races',
        'Decline To Self Identify',
      ],
      veteran_status: [
        'I am not a protected veteran',
        'I identify as one or more of the classifications of a protected veteran',
        "I don't wish to answer",
      ],
      disability_status: [
        'Yes, I have a disability, or have had one in the past',
        "No, I don't have a disability and have not had one in the past",
        "I don't wish to answer",
      ],
    };
    const pick = (id: keyof typeof options, d = data) =>
      picked(answerFor(choice(id), d), options[id]);
    expect(pick('gender')).toBe('Decline To Self Identify');
    expect(pick('hispanic_ethnicity')).toBe('No');
    expect(pick('race')).toBe('Asian');
    expect(pick('veteran_status')).toBe('I am not a protected veteran');
    expect(pick('disability_status')).toBe("I don't wish to answer");
    const notSaved = fillData({ voluntary: null });
    for (const id of Object.keys(options)) expect(answerFor(choice(id), notSaved)).toBeNull();
    const partly = fillData({ voluntary: { hispanicLatino: 'yes' } });
    expect(answerFor(choice('race'), partly)).toBeNull();
    expect(pick('hispanic_ethnicity', partly)).toBe('Yes');
  });

  it('leaves what no rule names, and what the person has no answer for', () => {
    expect(answerFor(text('question_6', 'Why do you want to work here?'), data)).toBeNull();
    expect(answerFor(choice('question_7', 'Have you previously worked at Acme?'), data)).toBeNull();
    const bare = fillData({ applicant: null, person: { links: {} } });
    expect(answerFor(text('first_name'), bare)).toBeNull();
    expect(answerFor(text('question_8', 'LinkedIn'), bare)).toBeNull();
    expect(answerFor(choice('question_9', 'Are you over 18?'), bare)).toBeNull();
    // A text answer never goes into a choice, and a file never into text.
    expect(answerFor(choice('question_10', 'LinkedIn'), data)).toBeNull();
  });
});
