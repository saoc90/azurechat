"use server";
import "server-only";

import { userHashedId } from "@/features/auth-page/helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { uniqueId } from "@/features/common/util";
import { SqlQuerySpec } from "@azure/cosmos";
import { HistoryContainer } from "../../common/services/cosmos";
import { ChatMessageModel, ChatRole, MESSAGE_ATTRIBUTE } from "./models";

export const FindTopChatMessagesForCurrentUser = async (
  chatThreadID: string,
  top: number = 30
): Promise<ServerActionResponse<Array<ChatMessageModel>>> => {
  try {
    const userId = await userHashedId();
    const container = await HistoryContainer<ChatMessageModel>();
    const resources = await container.find(
      {
        type: MESSAGE_ATTRIBUTE,
        threadId: chatThreadID,
        userId,
        isDeleted: false,
      },
      { sort: { createdAt: -1 }, limit: top }
    ).toArray();

    return { status: "OK", response: resources };
  } catch (e) {
    return { status: "ERROR", errors: [{ message: `${e}` }] };
  }
};

export const FindAllChatMessagesForCurrentUser = async (
  chatThreadID: string
): Promise<ServerActionResponse<Array<ChatMessageModel>>> => {
  try {
    const userId = await userHashedId();
    const container = await HistoryContainer<ChatMessageModel>();
    const resources = await container.find(
      {
        type: MESSAGE_ATTRIBUTE,
        threadId: chatThreadID,
        userId,
        isDeleted: false,
      },
      { sort: { createdAt: 1 } }
    ).toArray();

    return { status: "OK", response: resources };
  } catch (e) {
    return { status: "ERROR", errors: [{ message: `${e}` }] };
  }
};

export const CreateChatMessage = async ({
  name,
  content,
  role,
  chatThreadId,
  multiModalImage,
}: {
  name: string;
  role: ChatRole;
  content: string;
  chatThreadId: string;
  multiModalImage?: string;
}): Promise<ServerActionResponse<ChatMessageModel>> => {
  const userId = await userHashedId();
  const modelToSave: ChatMessageModel = {
    id: uniqueId(),
    createdAt: new Date(),
    type: MESSAGE_ATTRIBUTE,
    isDeleted: false,
    content: content,
    name: name,
    role: role,
    threadId: chatThreadId,
    userId: userId,
    multiModalImage: multiModalImage,
  };
  return await UpsertChatMessage(modelToSave);
};

export const UpsertChatMessage = async (
  chatModel: ChatMessageModel
): Promise<ServerActionResponse<ChatMessageModel>> => {
  try {
    const modelToSave = {
      ...chatModel,
      id: uniqueId(),
      createdAt: new Date(),
      type: MESSAGE_ATTRIBUTE,
      isDeleted: false,
    };

    const container = await HistoryContainer<ChatMessageModel>();
    // In MongoDB, to upsert, you use find one and update with upsert flag set to true
    const resource = await container.findOneAndUpdate(
      { id: modelToSave.id },
      { $set: { ...modelToSave, type: "CHAT_MESSAGE" } },
      { upsert: true, returnDocument: 'after' }
    );

    if (resource) {
      return { status: "OK", response: resource };
    }

    return { status: "ERROR", errors: [{ message: `Chat message not found` }] };
  } catch (e) {
    return { status: "ERROR", errors: [{ message: `${e}` }] };
  }
};

