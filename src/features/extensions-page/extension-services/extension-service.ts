"use server";
import "server-only";

import {
  getCurrentUser,
  userHashedId,
  userSession,
} from "@/features/auth-page/helpers";
import { UpsertChatThread } from "@/features/chat-page/chat-services/chat-thread-service";
import {
  CHAT_THREAD_ATTRIBUTE,
  ChatThreadModel,
} from "@/features/chat-page/chat-services/models";
import {
  ServerActionResponse,
  zodErrorsToServerActionErrors,
} from "@/features/common/server-action-response";
import { HistoryContainer } from "@/features/common/services/cosmos";
import { AzureKeyVaultInstance } from "@/features/common/services/key-vault";
import { uniqueId } from "@/features/common/util";
import { AI_NAME, CHAT_DEFAULT_PERSONA } from "@/features/theme/theme-config";
import {
  EXTENSION_ATTRIBUTE,
  ExtensionModel,
  ExtensionModelSchema,
} from "./models";

const KEY_VAULT_MASK = "**********";

export const FindExtensionByID = async (
  id: string
): Promise<ServerActionResponse<ExtensionModel>> => {
  try {
    const container = await HistoryContainer<ExtensionModel>();
    const queryResult = await container.findOne({ id: id, type: EXTENSION_ATTRIBUTE });

    if (!queryResult) {
      return {
        status: "NOT_FOUND",
        errors: [{ message: `Extension not found with id: ${id}` }],
      };
    }

    return {
      status: "OK",
      response: queryResult,
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `Error finding Extension: ${error}` }],
    };
  }
};


export const CreateExtension = async (
  inputModel: ExtensionModel
): Promise<ServerActionResponse<ExtensionModel>> => {
  try {

    const container = await HistoryContainer<ExtensionModel>();
    const result = await container.insertOne(inputModel);

    if (result.insertedId) {
      return {
        status: "OK",
        response: inputModel,
      };
    } else {
      return {
        status: "ERROR",
        errors: [{ message: "Error adding Extension" }],
      };
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [{ message: `Error adding Extension: ${error}` }],
    };
  }
};

const secureHeaderValues = async (extension: ExtensionModel) => {
  const vault = AzureKeyVaultInstance();

  const headers = extension.headers.map(async (h) => {
    if (h.value !== KEY_VAULT_MASK) {
      await vault.setSecret(h.id, h.value);
      h.value = KEY_VAULT_MASK;
    }

    return h;
  });

  await Promise.all(headers);

  return extension;
};

export const EnsureExtensionOperation = async (
  id: string
): Promise<ServerActionResponse<ExtensionModel>> => {
  const extensionResponse = await FindExtensionByID(id);
  const currentUser = await getCurrentUser();
  const hashedId = await userHashedId();

  if (extensionResponse.status === "OK") {
    if (currentUser.isAdmin || extensionResponse.response.userId === hashedId) {
      return extensionResponse;
    }
  }

  return {
    status: "UNAUTHORIZED",
    errors: [
      {
        message: `Extension not found with id: ${id}`,
      },
    ],
  };
};

// This function must only be used to retrieve the value within the APIs and Server functions.
// It should never be used to retrieve the value in the client.
export const FindSecureHeaderValue = async (
  headerId: string
): Promise<ServerActionResponse<string>> => {
  try {
    const vault = AzureKeyVaultInstance();
    const secret = await vault.getSecret(headerId);

    if (secret.value) {
      return {
        status: "OK",
        response: secret.value,
      };
    }

    return {
      status: "ERROR",
      errors: [
        {
          message: `Error finding secret: ${secret.value}`,
        },
      ],
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error finding secret: ${error}`,
        },
      ],
    };
  }
};

export const DeleteExtension = async (
  id: string
): Promise<ServerActionResponse<ExtensionModel>> => {
  try {
    const extensionResponse = await EnsureExtensionOperation(id);

    if (extensionResponse.status === "OK") {
      const vault = AzureKeyVaultInstance();
      extensionResponse.response.headers.map(async (h) => {
        await vault.beginDeleteSecret(h.id);
      });

      const container = await HistoryContainer<ExtensionModel>();
      const resource = await container.deleteOne({ id: id, userId: extensionResponse.response.userId });


      if (resource) {
        return {
          status: "OK",
          response: {} as ExtensionModel,
        };
      } else {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Error deleting Extension: ${resource}`,
            },
          ],
        };
      }
    }

    return extensionResponse;
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error deleting Extension: ${error}`,
        },
      ],
    };
  }
};

export const UpdateExtension = async (
  inputModel: ExtensionModel
): Promise<ServerActionResponse<ExtensionModel>> => {
  try {
    const extensionResponse = await EnsureExtensionOperation(inputModel.id);
    const user = await getCurrentUser();

    if (extensionResponse.status === "OK") {
      inputModel.isPublished = user.isAdmin
        ? inputModel.isPublished
        : extensionResponse.response.isPublished;

      inputModel.userId = extensionResponse.response.userId;
      inputModel.createdAt = new Date();
      inputModel.type = "EXTENSION";

      inputModel.headers.map((h) => {
        if (!h.id) {
          h.id = uniqueId();
        }
      });

      inputModel.functions.map((f) => {
        if (!f.id) {
          f.id = uniqueId();
        }
      });

      // schema validation
      const validatedFields = validateSchema(inputModel);

      if (validatedFields.status === "OK") {
        await secureHeaderValues(inputModel);

        const container = await HistoryContainer<ExtensionModel>();
        const result = await container.replaceOne(
          { id: inputModel.id, userId: inputModel.userId },
          inputModel
        );

        if (result.modifiedCount === 1) {
          return {
            status: "OK",
            response: inputModel,
          };
        } else {
          return {
            status: "ERROR",
            errors: [
              {
                message: `Error updating Extension: ${inputModel}`,
              },
            ],
          };
        }
      } else {
        return validatedFields;
      }
    } else {
      return extensionResponse;
    }
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error updating Extension: ${error}`,
        },
      ],
    };
  }
};

export const FindAllExtensionForCurrentUser = async (): Promise<
  ServerActionResponse<Array<ExtensionModel>>
> => {
  try {
    const userId = await userHashedId();
    const container = await HistoryContainer<ExtensionModel>();
    const queryResult = await container.find(
      { type: EXTENSION_ATTRIBUTE, $or: [{ isPublished: true }, { userId: userId }] }
    ).sort({ createdAt: -1 }).toArray();

    return {
      status: "OK",
      response: queryResult
    };
  } catch (error) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `Error finding Extension: ${error}`,
        },
      ],
    };
  }
};

export const CreateChatWithExtension = async (
  extensionId: string
): Promise<ServerActionResponse<ChatThreadModel>> => {
  const extensionResponse = await FindExtensionByID(extensionId);

  if (extensionResponse.status === "OK") {
    const extension = extensionResponse.response;

    const response = await UpsertChatThread({
      name: extension.name,
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
      extension: [extension.id],
    });

    return response;
  } else {
    return {
      status: "ERROR",
      errors: extensionResponse.errors,
    };
  }
};

const validateSchema = (model: ExtensionModel): ServerActionResponse => {
  const validatedFields = ExtensionModelSchema.safeParse(model);

  if (!validatedFields.success) {
    return {
      status: "ERROR",
      errors: zodErrorsToServerActionErrors(validatedFields.error.errors),
    };
  }

  return validateFunctionSchema(model);
};

const validateFunctionSchema = (
  model: ExtensionModel
): ServerActionResponse => {
  let functionNames: string[] = [];

  for (let i = 0; i < model.functions.length; i++) {
    const f = model.functions[i];
    try {
      const functionSchema = JSON.parse(f.code);
      const name = functionSchema.name;
      const findName = functionNames.find((n) => n === name);

      if (name === undefined || name === null || name === "") {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Function name is required.`,
            },
          ],
        };
      }

      if (name.includes(" ")) {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Function name ${name} cannot contain spaces.`,
            },
          ],
        };
      }

      if (findName) {
        return {
          status: "ERROR",
          errors: [
            {
              message: `Function name ${name} is already used. Please use a different name.`,
            },
          ],
        };
      } else {
        functionNames.push(name);
      }
    } catch (error) {
      return {
        status: "ERROR",
        errors: [
          {
            message: `Error validating function schema: ${error}. You can use ${AI_NAME} to generate a valid schema for your function.`,
          },
        ],
      };
    }
  }

  if (functionNames.length === 0) {
    return {
      status: "ERROR",
      errors: [
        {
          message: `At least one function is required.`,
        },
      ],
    };
  }

  return {
    status: "OK",
    response: model,
  };
};
