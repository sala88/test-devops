const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient();

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  try {
    const detail = event.detail;
    
    // Validazione base
    if (!detail || !detail.id || !detail.user_id) {
      throw new Error("Invalid event detail: missing id or user_id");
    }

    const orderId = detail.id;
    const userId = detail.user_id;
    const amount = detail.amount;
    
    // In un caso reale, recupereremmo l'email dell'utente dal DB o Cognito.
    // Qui usiamo una mail simulata o passata nell'evento se presente.
    const recipientEmail = detail.email || "simulator@example.com"; 

    const params = {
      Source: process.env.SENDER_EMAIL || "noreply@example.com",
      Destination: {
        ToAddresses: [recipientEmail],
      },
      Message: {
        Subject: {
          Data: `Order Confirmation #${orderId}`,
        },
        Body: {
          Text: {
            Data: `Hello ${userId},\n\nYour order #${orderId} for $${amount} has been successfully created.\n\nThank you!`,
          },
          Html: {
            Data: `<h1>Order Confirmation</h1><p>Hello <b>${userId}</b>,</p><p>Your order <b>#${orderId}</b> for <b>$${amount}</b> has been successfully created.</p><p>Thank you!</p>`,
          },
        },
      },
    };

    console.log(`Sending email to ${recipientEmail}...`);
    await ses.send(new SendEmailCommand(params));
    console.log("Email sent successfully");

    return { status: "success", message: "Email sent" };

  } catch (error) {
    console.error("Error processing event:", error);
    throw error; // Rilancia l'errore per attivare il retry/DLQ
  }
};
