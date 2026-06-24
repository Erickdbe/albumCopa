using UnityEngine;

namespace AventuraMundo
{
    [RequireComponent(typeof(CharacterController))]
    public class CreatureWanderer : MonoBehaviour
    {
        public string creatureName = "Criatura";
        public float maxHealth = 45f;
        public float moveSpeed = 1.8f;
        public float aggroRange = 7f;
        public float attackRange = 1.35f;
        public float attackDamage = 8f;
        public float attackCooldown = 1.1f;
        public Color biomeColor = Color.green;

        CharacterController controller;
        Transform target;
        Vector3 home;
        Vector3 wanderTarget;
        float health;
        float chooseTimer;
        float attackTimer;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            home = transform.position;
            health = maxHealth;
            PickWanderTarget();
        }

        void Update()
        {
            attackTimer -= Time.deltaTime;
            if (!target)
            {
                var player = Object.FindFirstObjectByType<AdventureCharacterController>();
                if (player) target = player.transform;
            }

            var destination = wanderTarget;
            if (target && Vector3.Distance(transform.position, target.position) <= aggroRange)
            {
                destination = target.position;
                if (Vector3.Distance(transform.position, target.position) <= attackRange)
                {
                    TryAttack();
                }
            }
            else
            {
                chooseTimer -= Time.deltaTime;
                if (chooseTimer <= 0f || Vector3.Distance(transform.position, wanderTarget) < 0.65f)
                {
                    PickWanderTarget();
                }
            }

            var dir = destination - transform.position;
            dir.y = 0f;
            if (dir.sqrMagnitude > 0.08f)
            {
                dir.Normalize();
                controller.Move(dir * moveSpeed * Time.deltaTime + Vector3.down * 4f * Time.deltaTime);
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir, Vector3.up), 10f * Time.deltaTime);
            }
        }

        void TryAttack()
        {
            if (attackTimer > 0f || !target) return;
            attackTimer = attackCooldown;
            var player = target.GetComponent<AdventureCharacterController>();
            if (player) player.TakeDamage(attackDamage);
        }

        void PickWanderTarget()
        {
            chooseTimer = Random.Range(1.8f, 4.4f);
            var offset = new Vector3(Random.Range(-5f, 5f), 0f, Random.Range(-5f, 5f));
            wanderTarget = home + offset;
        }

        public void TakeDamage(float amount, Transform attacker)
        {
            health -= amount;
            if (attacker) target = attacker;
            if (health <= 0f)
            {
                Destroy(gameObject);
            }
        }
    }
}
