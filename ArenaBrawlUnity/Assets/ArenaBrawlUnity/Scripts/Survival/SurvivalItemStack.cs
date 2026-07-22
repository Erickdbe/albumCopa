using System;
using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    [Serializable]
    public sealed class SurvivalItemStack
    {
        [SerializeField] private SurvivalItemDefinition definition;
        [SerializeField] private int quantity;

        public SurvivalItemStack(SurvivalItemDefinition definition, int quantity)
        {
            this.definition = definition;
            this.quantity = Mathf.Max(0, quantity);
        }

        public SurvivalItemDefinition Definition => definition;
        public int Quantity => quantity;
        public bool IsEmpty => definition == null || quantity <= 0;
        public int FreeSpace => definition == null ? 0 : Mathf.Max(0, definition.MaxStack - quantity);
        public float TotalWeight => definition == null ? 0f : definition.Weight * quantity;

        public int Add(int amount)
        {
            if (definition == null || amount <= 0)
            {
                return amount;
            }

            var accepted = Mathf.Min(amount, FreeSpace);
            quantity += accepted;
            return amount - accepted;
        }

        public int Remove(int amount)
        {
            if (amount <= 0)
            {
                return 0;
            }

            var removed = Mathf.Min(quantity, amount);
            quantity -= removed;
            return removed;
        }
    }
}
