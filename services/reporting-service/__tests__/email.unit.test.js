'use strict';

// Isolate module between tests so env var changes take effect.
beforeEach(() => jest.resetModules());

describe('email.engine — sendReportEmail', () => {
  test('E1 returns { skipped: true } when SMTP_HOST is not set', async () => {
    delete process.env.SMTP_HOST;
    const { sendReportEmail } = require('../src/engines/email');
    const result = await sendReportEmail({
      recipients: ['hr@example.com'],
      subject: 'Test',
      html: '<p>Test</p>',
    });
    expect(result.skipped).toBe(true);
  });

  test('E2 returns { skipped: true } for array recipients when SMTP_HOST absent', async () => {
    delete process.env.SMTP_HOST;
    const { sendReportEmail } = require('../src/engines/email');
    const result = await sendReportEmail({
      recipients: ['a@b.com', 'c@d.com'],
      subject: 'Multi',
      html: '<p>x</p>',
      attachmentName: 'report.csv',
      attachmentBuffer: Buffer.from('a,b\n1,2'),
      contentType: 'text/csv',
    });
    expect(result.skipped).toBe(true);
  });

  test('E3 createTransport called with correct config when SMTP_HOST is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';

    const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'abc' });
    const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockSendMail });
    jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }));

    const { sendReportEmail } = require('../src/engines/email');
    const result = await sendReportEmail({
      recipients: ['team@example.com'],
      subject: 'Weekly Report',
      html: '<p>hi</p>',
      attachmentName: 'report.csv',
      attachmentBuffer: Buffer.from('a,b'),
      contentType: 'text/csv',
    });

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
    }));
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'team@example.com',
      subject: 'Weekly Report',
    }));
    expect(result.sent).toBe(true);

    // cleanup
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });
});
