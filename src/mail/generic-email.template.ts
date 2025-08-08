export const genericEmailTemplate = (title: string, name: string, htmlContent: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: sans-serif; background-color: #f4f4f4;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="90%" style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <img src="cid:illustration" alt="logo" width="150" style="display: block;" />
            </td>
        </tr>
        <tr>
            <td align="center" style="padding: 20px 0; background-color: #3aafa9;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">${title}</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 20px 30px;">
                <h2 style="font-size: 24px; margin-top: 0;">Hello ${name},</h2>
                ${htmlContent}
                <p style="margin-top: 16px;">
                    Thank you,<br />
                    The CIM Amplify Team
                </p>
            </td>
        </tr>
        <tr>
            <td align="center" style="padding: 20px 0; color: #6b7280;">
                <p style="margin: 0;">You’re receiving this email because you have an active profile on CIM Amplify.</p>
                <p style="margin: 0;">© 2025 CIM Amplify. All rights reserved.</p>
            </td>
        </tr>
    </table>
</body>
</html>
`;