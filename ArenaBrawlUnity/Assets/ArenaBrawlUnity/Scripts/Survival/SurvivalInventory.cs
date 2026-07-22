using System;
using System.Collections.Generic;
using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalInventory : MonoBehaviour
    {
        [SerializeField] private int slotCapacity = 16;
        [SerializeField] private float weightCapacity = 35f;
        [SerializeField] private List<SurvivalItemStack> stacks = new List<SurvivalItemStack>();

        public event Action Changed;

        public IReadOnlyList<SurvivalItemStack> Stacks => stacks;
        public int SlotCapacity => Mathf.Max(1, slotCapacity);
        public float WeightCapacity => Mathf.Max(0f, weightCapacity);
        public int UsedSlots => stacks.Count;

        public float CurrentWeight
        {
            get
            {
                var total = 0f;
                for (var i = 0; i < stacks.Count; i++)
                {
                    total += stacks[i].TotalWeight;
                }

                return total;
            }
        }

        public bool CanAdd(SurvivalItemDefinition definition, int quantity)
        {
            if (definition == null || quantity <= 0)
            {
                return false;
            }

            if (CurrentWeight + definition.Weight * quantity > WeightCapacity)
            {
                return false;
            }

            var remaining = quantity;
            for (var i = 0; i < stacks.Count; i++)
            {
                var stack = stacks[i];
                if (stack.Definition == definition)
                {
                    remaining -= stack.FreeSpace;
                    if (remaining <= 0)
                    {
                        return true;
                    }
                }
            }

            var requiredNewSlots = Mathf.CeilToInt(remaining / (float)definition.MaxStack);
            return UsedSlots + requiredNewSlots <= SlotCapacity;
        }

        public bool TryAdd(SurvivalItemDefinition definition, int quantity)
        {
            if (!CanAdd(definition, quantity))
            {
                return false;
            }

            var remaining = quantity;
            for (var i = 0; i < stacks.Count && remaining > 0; i++)
            {
                if (stacks[i].Definition == definition)
                {
                    remaining = stacks[i].Add(remaining);
                }
            }

            while (remaining > 0)
            {
                var amount = Mathf.Min(remaining, definition.MaxStack);
                stacks.Add(new SurvivalItemStack(definition, amount));
                remaining -= amount;
            }

            Changed?.Invoke();
            return true;
        }

        public void AddSlots(int amount)
        {
            if (amount <= 0)
            {
                return;
            }

            slotCapacity += amount;
            Changed?.Invoke();
        }

        public int GetQuantity(string itemId)
        {
            var total = 0;
            for (var i = 0; i < stacks.Count; i++)
            {
                var definition = stacks[i].Definition;
                if (definition != null && definition.ItemId == itemId)
                {
                    total += stacks[i].Quantity;
                }
            }

            return total;
        }

        public bool TryConsume(string itemId, int quantity)
        {
            if (quantity <= 0 || GetQuantity(itemId) < quantity)
            {
                return false;
            }

            var remaining = quantity;
            for (var i = stacks.Count - 1; i >= 0 && remaining > 0; i--)
            {
                var definition = stacks[i].Definition;
                if (definition == null || definition.ItemId != itemId)
                {
                    continue;
                }

                remaining -= stacks[i].Remove(remaining);
                if (stacks[i].IsEmpty)
                {
                    stacks.RemoveAt(i);
                }
            }

            Changed?.Invoke();
            return true;
        }

        public bool TryFindFirst(SurvivalItemType type, out SurvivalItemDefinition definition)
        {
            for (var i = 0; i < stacks.Count; i++)
            {
                definition = stacks[i].Definition;
                if (definition != null && definition.ItemType == type)
                {
                    return true;
                }
            }

            definition = null;
            return false;
        }

        public bool TryUseConsumable(SurvivalItemDefinition definition, SurvivalHealth health)
        {
            if (definition == null || definition.ItemType != SurvivalItemType.Consumable)
            {
                return false;
            }

            if (!TryConsume(definition.ItemId, 1))
            {
                return false;
            }

            if (health != null && definition.HealAmount > 0f)
            {
                health.Heal(definition.HealAmount);
            }

            return true;
        }
    }
}
