"use server";
import "server-only";

import {
  getCurrentUser,
  userHashedId,
  userSession,
} from "@/features/auth-page/helpers";
import { RedirectToChatThread } from "@/features/common/navigation-helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { uniqueId } from "@/features/common/util";
import {
  CHAT_DEFAULT_PERSONA,
  NEW_CHAT_NAME,
} from "@/features/theme/theme-config";
import { HistoryContainer } from "../../common/services/cosmos";
import { DeleteDocuments } from "./azure-ai-search/azure-ai-search";
import { FindAllChatDocuments } from "./chat-document-service";
import { FindAllChatMessagesForCurrentUser } from "./chat-message-service";
import {
  CHAT_THREAD_ATTRIBUTE,
  ChatThreadModel,
} from "./models";
import { Filter } from "mongodb";

export const FindAllChatThreadForCurrentUser = async (): Promise<
  ServerActionResponse<Array<ChatThreadModel>>
> => {
  try {
    const userId = await userHashedId();
    const container = await HistoryContainer<ChatThreadModel>();
    const query: Filter<ChatThreadModel> = {
      type: "CHAT_THREAD",
      userId: userId,
      isDeleted: false,
    };
    const resources = await container.find(query).sort({ createdAt: -1 }).toArray();

    return {
      status: "OK",
      response: resources,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const FindChatThreadForCurrentUser = async (
  id: string
): Promise<ServerActionResponse<ChatThreadModel>> => {
  try {
    const userId = await userHashedId();
    const container = await HistoryContainer<ChatThreadModel>();
    const query: Filter<ChatThreadModel> = {
      type: CHAT_THREAD_ATTRIBUTE,
      userId: userId,
      id: id,
      isDeleted: false,
    };
    const resources = await container.find(query).toArray();

    if (resources.length === 0) {
      return {
        status: "NOT_FOUND",
        errors: [{ message: `Chat thread not found` }],
      };
    }

    return {
      status: "OK",
      response: resources[0],
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const SoftDeleteChatThreadForCurrentUser = async (
  chatThreadID: string
): Promise<ServerActionResponse<ChatThreadModel>> => {
  try {
    const chatThreadResponse = await FindChatThreadForCurrentUser(chatThreadID);

    if (chatThreadResponse.status === "OK") {
      const chatResponse = await FindAllChatMessagesForCurrentUser(chatThreadID);

      if (chatResponse.status !== "OK") {
        return chatResponse;
      }
      const chats = chatResponse.response;
      const container = await HistoryContainer<ChatThreadModel>();

      // Mark all messages in the thread as deleted
      for (const chat of chats) {
        await container.updateOne(
          { id: chat.id },
          { $set: { isDeleted: true } }
        );
      }

      const chatDocumentsResponse = await FindAllChatDocuments(chatThreadID);

      if (chatDocumentsResponse.status !== "OK") {
        return chatDocumentsResponse;
      }

      const chatDocuments = chatDocumentsResponse.response;

      // Perform additional operations if necessary before marking the documents as deleted
      if (chatDocuments.length !== 0) {
        await DeleteDocuments(chatThreadID); // Make sure DeleteDocuments is implemented for MongoDB
      }

      // Mark all documents in the thread as deleted
      for (const chatDocument of chatDocuments) {
        await container.updateOne(
          { id: chatDocument.id },
          { $set: { isDeleted: true } }
        );
      }

      // Mark the chat thread as deleted
      await container.updateOne(
        { id: chatThreadResponse.response.id },
        { $set: { isDeleted: true } }
      );

      // Return the chat thread marked as deleted
      chatThreadResponse.response.isDeleted = true;
      return chatThreadResponse;
    }

    // Return the original response if the chatThread was not found
    return chatThreadResponse;
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const EnsureChatThreadOperation = async (
  chatThreadID: string
): Promise<ServerActionResponse<ChatThreadModel>> => {
  const response = await FindChatThreadForCurrentUser(chatThreadID);
  const currentUser = await getCurrentUser();
  const hashedId = await userHashedId();

  if (response.status === "OK") {
    if (currentUser.isAdmin || response.response.userId === hashedId) {
      return response;
    }
  }

  return response;
};

export const AddExtensionToChatThread = async (props: {
  chatThreadId: string;
  extensionId: string;
}): Promise<ServerActionResponse<ChatThreadModel>> => {
  try {
    const response = await FindChatThreadForCurrentUser(props.chatThreadId);
    if (response.status === "OK") {
      const chatThread = response.response;

      const existingExtension = chatThread.extension.find(
        (e) => e === props.extensionId
      );

      if (existingExtension === undefined) {
        chatThread.extension.push(props.extensionId);
        return await UpsertChatThread(chatThread);
      }

      return {
        status: "OK",
        response: chatThread,
      };
    }

    return response;
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const RemoveExtensionFromChatThread = async (props: {
  chatThreadId: string;
  extensionId: string;
}): Promise<ServerActionResponse<ChatThreadModel>> => {
  const response = await FindChatThreadForCurrentUser(props.chatThreadId);
  if (response.status === "OK") {
    const chatThread = response.response;
    chatThread.extension = chatThread.extension.filter(
      (e) => e !== props.extensionId
    );

    return await UpsertChatThread(chatThread);
  }

  return response;
};

export const UpsertChatThread = async (
  chatThread: ChatThreadModel
): Promise<ServerActionResponse<ChatThreadModel>> => {
  try {
    const container = await HistoryContainer<ChatThreadModel>();
    let upsertedChatThread;

    if (chatThread.id) {
      // If the _id is specified, we are updating an existing document.
      const result = await container.updateOne(
        { id: chatThread.id },
        { $set: chatThread },
        { upsert: true } // This option creates a new document if no document matches the filter.
      );
      
      // If the modification count is 0 and upsertedId is null, it means the document was not found.
      if (result.modifiedCount === 0 && !result.upsertedId) {
        throw new Error('No document was updated, and no new document was upserted.');
      }
      
      if (result.upsertedId) {
        // If an upsert happened, return the _id of the upserted document.
        upsertedChatThread = { ...chatThread, _id: result.upsertedId };
      } else {
        // Otherwise, return the updated chat thread as is.
        upsertedChatThread = chatThread;
      }
    } else {
      // If no _id is provided, we are creating a new document.
      const result = await container.insertOne(chatThread);
      upsertedChatThread = { ...chatThread, _id: result.insertedId };
    }
    
    // Return the upserted/updated chat thread object
    return {
      status: "OK",
      response: upsertedChatThread,
    };

  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const CreateChatThread = async (): Promise<
  ServerActionResponse<ChatThreadModel>
> => {
  try {
    const hashedUserId = await userHashedId();
    const userSessionData = await userSession();
    if (!userSessionData) {
      throw new Error('User session not found');
    }
    
    const modelToSave: ChatThreadModel = {
      name: NEW_CHAT_NAME,
      useName: (await userSession())!.name,
      userId: await userHashedId(),
      id: uniqueId(),
      createdAt: new Date(),
      lastMessageAt: new Date(),
      bookmarked: false,
      isDeleted: false,
      type: CHAT_THREAD_ATTRIBUTE,
      personaMessage: "",
      personaMessageTitle: CHAT_DEFAULT_PERSONA,
      extension: [],
    };

    // Get the MongoDB collection object from HistoryContainer
    const container = await HistoryContainer<ChatThreadModel>();
    
    // Insert the new chat thread into the collection
    const result = await container.insertOne(modelToSave);

    // Check if the insert was successful based on the result
    if (result.insertedId) {
      // Send back the response with status OK and the newly created chat thread
      return {
        status: "OK",
        response: modelToSave 
      };
    } else {
      throw new Error('Failed to create a new chat thread');
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const UpdateChatTitle = async (
  chatThreadId: string,
  title: string
): Promise<ServerActionResponse<ChatThreadModel>> => {
  try {
    const response = await FindChatThreadForCurrentUser(chatThreadId);
    if (response.status === "OK") {
      const chatThread = response.response;
      // take the first 30 characters
      chatThread.name = title.substring(0, 30);
      return await UpsertChatThread(chatThread);
    }
    return response;
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

export const CreateChatAndRedirect = async () => {
  const response = await CreateChatThread();
  if (response.status === "OK") {
    RedirectToChatThread(response.response.id);
  }
};
