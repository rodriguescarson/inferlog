CREATE TYPE "public"."conversation_status" AS ENUM('active', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."log_status" AS ENUM('success', 'error', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"session_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "log_status" NOT NULL,
	"latency_ms" integer,
	"ttfb_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"finish_reason" text,
	"error_message" text,
	"input_preview" text,
	"output_preview" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inference_logs_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inference_logs" ADD CONSTRAINT "inference_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_logs" ADD CONSTRAINT "inference_logs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("session_id","updated_at");--> statement-breakpoint
CREATE INDEX "logs_created_idx" ON "inference_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "logs_status_idx" ON "inference_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "logs_model_idx" ON "inference_logs" USING btree ("model","created_at");--> statement-breakpoint
CREATE INDEX "logs_conversation_idx" ON "inference_logs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");