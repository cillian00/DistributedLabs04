import { SNSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
    SESClient,
    SendEmailCommand,
    SendEmailCommandInput,
} from "@aws-sdk/client-ses";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
    throw new Error(
        "Please add the SES_EMAIL_TO, SES_EMAIL_FROM, and SES_REGION environment variables in an env.ts.js file located in the root directory"
    );
}

type ContactDetails = {
    name: string;
    email: string;
    message: string;
};

const client = new SESClient({ region: SES_REGION });

export const handler: SNSHandler = async (event: any) => {
    console.log("Event ", event);

    if (!event.Records || event.Records.length === 0) {
        console.log("Invalid SNS event format. Missing 'Records'.");
        // Handle the case where 'Records' is missing in the event
        return;
    }

    for (const record of event.Records) {
        if (!record.body) {
            console.log("Invalid SQS message format. Missing 'body'.");
            // Handle the case where 'body' is missing in the record
            continue;
        }

        const sqsMessage = JSON.parse(record.body);

        if (!sqsMessage.Message || !sqsMessage.Subject) {
            console.log("Invalid event format. Missing 'Message' or 'Subject'.");
            continue;
        }

        console.log("SQS Message ", JSON.stringify(sqsMessage));

        // Removed parsing of S3 message as it's not relevant

        const { name, email, message }: ContactDetails = {
            name: "The Photo Album",
            email: SES_EMAIL_FROM,
            message: `We received your message: ${sqsMessage.Message}`,
        };

        try {
            const params = sendEmailParams({ name, email, message });
            await client.send(new SendEmailCommand(params));
        } catch (error: unknown) {
            console.log("ERROR is: ", error);
            // Handle error as needed
        }
    }
};

function sendEmailParams({ name, email, message }: ContactDetails) {
    const parameters: SendEmailCommandInput = {
        Destination: {
            ToAddresses: [SES_EMAIL_TO],
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: getHtmlContent({ name, email, message }),
                },
                Text: {
                    Charset: "UTF-8",
                    Data: getTextContent({ name, email, message }),
                },
            },
            Subject: {
                Charset: "UTF-8",
                Data: `New message received`,
            },
        },
        Source: SES_EMAIL_FROM,
    };
    return parameters;
}

function getHtmlContent({ name, email, message }: ContactDetails) {
    return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}

function getTextContent({ name, email, message }: ContactDetails) {
    return `
    Received a new message. 📬
    Sent from:
        👤 ${name}
        ✉️ ${email}
    ${message}
  `;
}
