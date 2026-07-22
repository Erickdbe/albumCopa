using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    [RequireComponent(typeof(SurvivalHealth))]
    public sealed class SurvivalThreatAI : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private float daySpeed = 2.4f;
        [SerializeField] private float nightSpeed = 3.8f;
        [SerializeField] private float detectRadius = 22f;
        [SerializeField] private float attackRange = 1.7f;
        [SerializeField] private float attackDamage = 12f;
        [SerializeField] private float attackCooldown = 1.25f;
        [SerializeField] private float patrolRadius = 9f;
        [SerializeField] private float turnSpeed = 8f;

        private CharacterController controller;
        private Vector3 patrolCenter;
        private Vector3 patrolTarget;
        private float nextAttackTime;

        private void Awake()
        {
            controller = GetComponent<CharacterController>();
            patrolCenter = transform.position;
            PickPatrolTarget();
        }

        private void Update()
        {
            if (target == null)
            {
                target = SurvivalGameManager.Instance != null ? SurvivalGameManager.Instance.Player : null;
            }

            if (target == null)
            {
                Patrol();
                return;
            }

            var toTarget = target.position - transform.position;
            toTarget.y = 0f;
            var distance = toTarget.magnitude;
            var aggression = SurvivalGameManager.Instance != null ? SurvivalGameManager.Instance.ThreatAggressionMultiplier : 1f;
            var activeDetectRadius = detectRadius * aggression;

            if (distance <= activeDetectRadius)
            {
                Chase(toTarget, distance, aggression);
            }
            else
            {
                Patrol();
            }
        }

        private void Chase(Vector3 toTarget, float distance, float aggression)
        {
            if (distance > attackRange)
            {
                Move(toTarget.normalized, Mathf.Lerp(daySpeed, nightSpeed, Mathf.Clamp01(aggression - 1f)));
                return;
            }

            FaceDirection(toTarget.normalized);
            if (Time.time < nextAttackTime)
            {
                return;
            }

            nextAttackTime = Time.time + attackCooldown / aggression;
            var health = target.GetComponent<SurvivalHealth>();
            if (health != null)
            {
                health.Damage(attackDamage * aggression, gameObject);
            }
        }

        private void Patrol()
        {
            var toPatrol = patrolTarget - transform.position;
            toPatrol.y = 0f;
            if (toPatrol.sqrMagnitude < 1.2f)
            {
                PickPatrolTarget();
                return;
            }

            Move(toPatrol.normalized, daySpeed * 0.45f);
        }

        private void Move(Vector3 direction, float speed)
        {
            if (direction.sqrMagnitude <= 0.001f)
            {
                return;
            }

            FaceDirection(direction);

            if (controller != null && controller.enabled)
            {
                controller.SimpleMove(direction * speed);
            }
            else
            {
                transform.position += direction * speed * Time.deltaTime;
            }
        }

        private void FaceDirection(Vector3 direction)
        {
            if (direction.sqrMagnitude <= 0.001f)
            {
                return;
            }

            var targetRotation = Quaternion.LookRotation(direction, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, targetRotation, turnSpeed * Time.deltaTime);
        }

        private void PickPatrolTarget()
        {
            var offset = Random.insideUnitCircle * patrolRadius;
            patrolTarget = patrolCenter + new Vector3(offset.x, 0f, offset.y);
        }
    }
}
