import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export class EDAAppStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const imagesBucket = new s3.Bucket(this, "images", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            publicReadAccess: false,
        });


        // Tables

        const imagesTable = new dynamodb.Table(this, "ImagesTable", {
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: "imageName", type: dynamodb.AttributeType.STRING },

            removalPolicy: cdk.RemovalPolicy.DESTROY,
            tableName: "ImageTable",
        })



        // Queues
        const badOrdersQueue = new sqs.Queue(this, "bad-orders-q", {
            retentionPeriod: Duration.minutes(30),
        });

        const ordersQueue = new sqs.Queue(this, "orders-queue", {
            deadLetterQueue: {
                queue: badOrdersQueue,
                maxReceiveCount: 2,
            },
        });

        // Integration infrastructure
        const newImageTopic = new sns.Topic(this, "NewImageTopic", {
            displayName: "New Image topic",
        });

        // Lambda functions
        const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
            runtime: lambda.Runtime.NODEJS_16_X,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(3),
            entry: `${__dirname}/../lambdas/mailer.ts`,
        });

        const failedMailerFn = new lambdanode.NodejsFunction(
            this,
            "failed-mailer-function",
            {
                runtime: lambda.Runtime.NODEJS_16_X,
                memorySize: 1024,
                timeout: cdk.Duration.seconds(3),
                entry: `${__dirname}/../lambdas/rejection-mailer.ts`,
            }
        );

        const processImageFn = new lambdanode.NodejsFunction(
            this,
            "ProcessImageFn",
            {
                // architecture: lambda.Architecture.ARM_64,
                runtime: lambda.Runtime.NODEJS_18_X,
                entry: `${__dirname}/../lambdas/processImage.ts`,
                timeout: cdk.Duration.seconds(15),
                memorySize: 128,
                environment: {
                    TABLE_NAME: imagesTable.tableName
                }
            }
        );

        imagesBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3n.SnsDestination(newImageTopic)
        );

        newImageTopic.addSubscription(
            new subs.LambdaSubscription(mailerFn)
        );

        newImageTopic.addSubscription(
            new subs.SqsSubscription(ordersQueue)
        );


        failedMailerFn.addEventSource(
            new SqsEventSource(badOrdersQueue, {
                maxBatchingWindow: Duration.seconds(5),
                maxConcurrency: 2,
            })
        );

        processImageFn.addEventSource(
            new SqsEventSource(ordersQueue, {
                maxBatchingWindow: Duration.seconds(5),
                maxConcurrency: 2,
            })
        );

        // Permissions
        imagesBucket.grantRead(processImageFn);
        badOrdersQueue.grantSendMessages(failedMailerFn);
        ordersQueue.grantSendMessages(failedMailerFn);
        imagesTable.grantReadWriteData(processImageFn);


        mailerFn.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "ses:SendEmail",
                    "ses:SendRawEmail",
                    "ses:SendTemplatedEmail",
                ],
                resources: ["*"],
            })
        );

        failedMailerFn.addToRolePolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "ses:SendEmail",
                    "ses:SendRawEmail",
                    "ses:SendTemplatedEmail",
                ],
                resources: ["*"],
            })
        );

        // Output
        new cdk.CfnOutput(this, "bucketName", {
            value: imagesBucket.bucketName,
        });
    }
}
