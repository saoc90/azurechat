import { userHashedId } from "@/features/auth-page/helpers";
import { ServerActionResponse } from "@/features/common/server-action-response";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { uniqueId } from "@/features/common/util";
import { DocumentSearchResponse } from "./azure-ai-search/azure-ai-search";
import { CHAT_CITATION_ATTRIBUTE, ChatCitationModel } from "./models";

export const CreateCitation = async (
  model: ChatCitationModel
): Promise<ServerActionResponse<ChatCitationModel>> => {
  try {
    const container = await HistoryContainer<ChatCitationModel>();

    const resource = await container.insertOne(model);

    if (!resource) {
      return {
        status: "ERROR",
        errors: [{ message: "Citation not created" }],
      };
    }

    return {
      status: "OK",
      response: model,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `${error}` }],
    };
  }
};

// Create citations for the documents with a user as optional parameter
// when calling this method from the extension, you must provide the user as the REST API does not have access to the user
export const CreateCitations = async (
  models: DocumentSearchResponse[],
  userId?: string
): Promise<Array<ServerActionResponse<ChatCitationModel>>> => {
  const items: Array<Promise<ServerActionResponse<ChatCitationModel>>> = [];

  for (const model of models) {
    const res = CreateCitation({
      content: model,
      id: uniqueId(),
      type: CHAT_CITATION_ATTRIBUTE,
      userId: userId || (await userHashedId()),
    });

    items.push(res);
  }

  return await Promise.all(items);
};

export const FindCitationByID = async (
  id: string
): Promise<ServerActionResponse<ChatCitationModel>> => {
  try {

    const container = await HistoryContainer<ChatCitationModel>();

    const resources = await container.find({ id: id, type: "CHAT_CITATION", userId: await userHashedId() }).toArray();

    if (resources.length === 0) {
      return {
        status: "ERROR",
        errors: [{ message: "Citation not found" }],
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

export const FormatCitations = (citation: DocumentSearchResponse[]) => {
  const withoutEmbedding: DocumentSearchResponse[] = [];
  citation.forEach((d) => {
    withoutEmbedding.push({
      score: d.score,
      document: {
        metadata: d.document.metadata,
        pageContent: d.document.pageContent,
        chatThreadId: d.document.chatThreadId,
        id: "",
        user: "",
      },
    });
  });

  return withoutEmbedding;
};
