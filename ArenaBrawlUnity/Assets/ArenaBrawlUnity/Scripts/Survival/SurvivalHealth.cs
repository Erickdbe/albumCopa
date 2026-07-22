using System;
using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalHealth : MonoBehaviour
    {
        [SerializeField] private float maxHealth = 100f;
        [SerializeField] private bool destroyOnDeath = true;
        [SerializeField] private float destroyDelay = 1.5f;

        private float currentHealth;
        private bool dead;

        public event Action<SurvivalHealth> Died;

        public float MaxHealth => Mathf.Max(1f, maxHealth);
        public float CurrentHealth => currentHealth;
        public float NormalizedHealth => Mathf.Clamp01(currentHealth / MaxHealth);
        public bool IsDead => dead;

        private void Awake()
        {
            currentHealth = MaxHealth;
        }

        public void Damage(float amount, GameObject source)
        {
            if (dead || amount <= 0f)
            {
                return;
            }

            currentHealth = Mathf.Max(0f, currentHealth - amount);
            if (currentHealth <= 0f)
            {
                Die();
            }
        }

        public void Heal(float amount)
        {
            if (dead || amount <= 0f)
            {
                return;
            }

            currentHealth = Mathf.Min(MaxHealth, currentHealth + amount);
        }

        private void Die()
        {
            dead = true;
            Died?.Invoke(this);

            var controller = GetComponent<CharacterController>();
            if (controller != null)
            {
                controller.enabled = false;
            }

            if (destroyOnDeath)
            {
                Destroy(gameObject, destroyDelay);
            }
        }
    }
}
