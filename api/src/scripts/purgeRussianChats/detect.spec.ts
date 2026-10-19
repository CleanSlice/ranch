import { hasCyrillic, scanTranscript } from './detect';

const msg = (role: string, text: string) => ({ role, text });

describe('hasCyrillic', () => {
  it('finds Russian text', () => {
    expect(hasCyrillic('привет')).toBe(true);
  });

  it('leaves pure English alone', () => {
    expect(hasCyrillic('what trim level has leather seats?')).toBe(false);
  });

  it('is false for an empty string', () => {
    expect(hasCyrillic('')).toBe(false);
  });

  it('catches a single Russian word inside English', () => {
    expect(hasCyrillic('the trim is Люкс, I think')).toBe(true);
  });
});

describe('scanTranscript', () => {
  it('flags a chat the person wrote in Russian', () => {
    const scan = scanTranscript([
      msg('user', 'привет'),
      msg('assistant', 'Hello! How can I help?'),
    ]);

    expect(scan.hit).toBe(true);
    expect(scan.userChars).toBe(6);
    expect(scan.assistantChars).toBe(0);
  });

  it('flags a chat where only the bot answered in Russian', () => {
    // The chat list preview shows the last message whatever its role, so a
    // Russian reply to an English question is visible to the customer too.
    const scan = scanTranscript([
      msg('user', 'what trim has leather seats?'),
      msg('assistant', 'Кожаные сиденья'),
    ]);

    expect(scan.hit).toBe(true);
    expect(scan.userChars).toBe(0);
    expect(scan.assistantChars).toBe(14);
  });

  it('leaves a pure English chat alone', () => {
    const scan = scanTranscript([
      msg('user', 'hi'),
      msg('assistant', 'Hello! How can I help?'),
    ]);

    expect(scan.hit).toBe(false);
    expect(scan.userChars).toBe(0);
    expect(scan.assistantChars).toBe(0);
  });

  it('counts characters so a one-word case can be spotted before deleting', () => {
    const scan = scanTranscript([
      msg('user', 'is the Люкс trim available in 2026?'),
    ]);

    expect(scan.hit).toBe(true);
    expect(scan.userChars).toBe(4);
  });

  it('is not a hit for an empty transcript', () => {
    const scan = scanTranscript([]);

    expect(scan.hit).toBe(false);
    expect(scan.userChars).toBe(0);
    expect(scan.assistantChars).toBe(0);
  });

  it('counts roles other than user as assistant-side text', () => {
    // read() surfaces user + assistant by default; anything else that slips
    // through still has to be seen, not silently ignored.
    const scan = scanTranscript([msg('summary', 'Клиент спрашивал про CX-5')]);

    expect(scan.hit).toBe(true);
    expect(scan.assistantChars).toBe(18);
  });
});
