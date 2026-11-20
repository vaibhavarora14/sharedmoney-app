import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecurringTemplate, Transaction } from "../types";
import { fetchWithAuth } from "../utils/api";
import { useCreateTransaction } from "./useTransactions";
import { queryKeys } from "./queryKeys";

export type RecurringTemplateWrite = {
  title: string;
  amount: number;
  currency: string;
  category?: string | null;
  cadence: RecurringTemplate["cadence"];
  anchor_date: string;
  paid_by_participant_id?: string | null;
  split_among_participant_ids?: string[];
  status?: RecurringTemplate["status"];
};

export function useRecurringTemplates(groupId: string, onExpenseCreated?: () => void) {
  const queryClient = useQueryClient();
  const createExpense = useCreateTransaction(() => {
    onExpenseCreated?.();
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.transactionsFeed(groupId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.balances(groupId) });
  };

  const createTemplate = useMutation({
    mutationFn: async (input: RecurringTemplateWrite) => {
      const response = await fetchWithAuth(`/groups/${groupId}/recurring-templates`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Failed to create recurring template");
      return response.json() as Promise<RecurringTemplate>;
    },
    onSuccess: invalidate,
  });

  const updateTemplate = useMutation({
    mutationFn: async (input: Partial<RecurringTemplateWrite> & { id: string }) => {
      const response = await fetchWithAuth(`/groups/${groupId}/recurring-templates`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Failed to update recurring template");
      return response.json() as Promise<RecurringTemplate>;
    },
    onSuccess: invalidate,
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/groups/${groupId}/recurring-templates?id=${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete recurring template");
    },
    onSuccess: invalidate,
  });

  const recordCycle = useMutation({
    mutationFn: async (input: { template_id: string; action: "add" | "skip"; transaction_id?: number; period_key: string }) => {
      const response = await fetchWithAuth(`/groups/${groupId}/recurring-template-cycles`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error("Failed to update this cycle");
      return response.json();
    },
    onSuccess: invalidate,
  });

  const addDueExpense = async (template: RecurringTemplate) => {
    const splitIds = template.split_among_participant_ids?.filter(Boolean) || [];
    const created = await createExpense.mutate({
      description: template.title,
      amount: template.amount,
      date: new Date().toISOString().slice(0, 10),
      type: "expense",
      category: template.category || undefined,
      currency: template.currency,
      group_id: groupId,
      paid_by_participant_id: template.paid_by_participant_id || undefined,
      split_among_participant_ids: splitIds.length > 0 ? splitIds : undefined,
    });
    const transactionId = (created as Transaction | null)?.id;
    if (!transactionId) {
      throw new Error("The expense could not be linked to this cycle. Check the group feed before adding it again.");
    }
    try {
      await recordCycle.mutateAsync({
        template_id: template.id,
        action: "add",
        transaction_id: transactionId,
        period_key: template.current_period_key,
      });
    } catch (error) {
      throw new Error(
        error instanceof Error && /already marked/i.test(error.message)
          ? error.message
          : "Expense was added, but this cycle wasn’t marked. Refresh before adding it again.",
      );
    }
  };

  return {
    createTemplate,
    updateTemplate,
    deleteTemplate,
    recordCycle,
    addDueExpense,
    isWorking:
      createTemplate.isPending
      || updateTemplate.isPending
      || deleteTemplate.isPending
      || recordCycle.isPending
      || createExpense.isLoading,
  };
}
