using UnityEngine;

namespace AventuraMundo
{
    [RequireComponent(typeof(CharacterController))]
    public class AdventureCharacterController : MonoBehaviour
    {
        [Header("Movement")]
        public float walkSpeed = 4.2f;
        public float runSpeed = 6.4f;
        public float dashSpeed = 14f;
        public float dashDuration = 0.18f;
        public float rotationSpeed = 14f;
        public float gravity = -24f;

        [Header("Combat")]
        public float maxHealth = 120f;
        public float attackDamage = 18f;
        public float strongDamage = 34f;
        public float attackRange = 1.7f;
        public float attackRadius = 0.75f;
        public float attackCooldown = 0.34f;
        public float projectileCooldown = 0.9f;
        public GameObject projectilePrefab;
        public Transform castPoint;

        [Header("Runtime")]
        public Transform cameraTransform;
        public bool isLocalPlayer = true;

        CharacterController controller;
        Animator animator;
        Vector3 velocity;
        Vector3 moveDirection = Vector3.forward;
        float health;
        float attackTimer;
        float projectileTimer;
        float dashTimer;
        bool blocking;

        public float Health => health;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            animator = GetComponentInChildren<Animator>();
            health = maxHealth;

            if (!castPoint)
            {
                var point = new GameObject("CastPoint").transform;
                point.SetParent(transform, false);
                point.localPosition = new Vector3(0f, 1.15f, 0.75f);
                castPoint = point;
            }
        }

        void Update()
        {
            if (!isLocalPlayer) return;

            attackTimer -= Time.deltaTime;
            projectileTimer -= Time.deltaTime;
            UpdateMovement();
            UpdateAim();
            UpdateCombat();
            UpdateAnimator();
        }

        void UpdateMovement()
        {
            var input = new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical"));
            input = Vector2.ClampMagnitude(input, 1f);

            var forward = Vector3.forward;
            var right = Vector3.right;
            if (cameraTransform)
            {
                forward = cameraTransform.forward;
                right = cameraTransform.right;
                forward.y = 0f;
                right.y = 0f;
                forward.Normalize();
                right.Normalize();
            }

            var desired = forward * input.y + right * input.x;
            if (desired.sqrMagnitude > 0.02f)
            {
                moveDirection = desired.normalized;
            }

            var speed = Input.GetKey(KeyCode.LeftShift) ? runSpeed : walkSpeed;
            if ((Input.GetKeyDown(KeyCode.Q) || Input.GetKeyDown(KeyCode.LeftShift)) && dashTimer <= 0f && desired.sqrMagnitude > 0.02f)
            {
                dashTimer = dashDuration;
            }

            if (dashTimer > 0f)
            {
                speed = dashSpeed;
                dashTimer -= Time.deltaTime;
            }

            var horizontal = desired.normalized * speed;
            if (desired.sqrMagnitude <= 0.02f) horizontal = Vector3.zero;

            if (controller.isGrounded && velocity.y < 0f) velocity.y = -2f;
            velocity.y += gravity * Time.deltaTime;

            controller.Move((horizontal + velocity) * Time.deltaTime);
        }

        void UpdateAim()
        {
            if (!Camera.main) return;

            var ray = Camera.main.ScreenPointToRay(Input.mousePosition);
            var ground = new Plane(Vector3.up, Vector3.zero);
            if (ground.Raycast(ray, out var enter))
            {
                var target = ray.GetPoint(enter);
                var dir = target - transform.position;
                dir.y = 0f;
                if (dir.sqrMagnitude > 0.1f)
                {
                    moveDirection = dir.normalized;
                }
            }

            if (moveDirection.sqrMagnitude > 0.01f)
            {
                var targetRotation = Quaternion.LookRotation(moveDirection, Vector3.up);
                transform.rotation = Quaternion.Slerp(transform.rotation, targetRotation, rotationSpeed * Time.deltaTime);
            }
        }

        void UpdateCombat()
        {
            blocking = Input.GetMouseButton(1) || Input.GetKey(KeyCode.E);

            if (Input.GetMouseButtonDown(0))
            {
                TryMelee(false);
            }

            if (Input.GetMouseButtonDown(1))
            {
                TryMelee(true);
            }

            if (Input.GetKeyDown(KeyCode.R))
            {
                TryProjectile(false);
            }

            if (Input.GetKeyDown(KeyCode.X))
            {
                TryProjectile(true);
                TryAreaPulse(strongDamage * 1.4f, 3.2f);
            }
        }

        void TryMelee(bool strong)
        {
            if (attackTimer > 0f) return;
            attackTimer = strong ? attackCooldown * 1.7f : attackCooldown;
            var center = transform.position + transform.forward * attackRange + Vector3.up * 0.9f;
            var hits = Physics.OverlapSphere(center, attackRadius, ~0, QueryTriggerInteraction.Ignore);
            foreach (var hit in hits)
            {
                var creature = hit.GetComponentInParent<CreatureWanderer>();
                if (creature) creature.TakeDamage(strong ? strongDamage : attackDamage, transform);
            }
            SpawnImpact(center, strong ? new Color(1f, 0.52f, 0.2f) : new Color(1f, 0.9f, 0.35f), strong ? 0.55f : 0.35f);
        }

        void TryProjectile(bool ultimate)
        {
            if (!projectilePrefab || projectileTimer > 0f) return;
            projectileTimer = ultimate ? projectileCooldown * 1.7f : projectileCooldown;

            var shot = Instantiate(projectilePrefab, castPoint.position, Quaternion.LookRotation(transform.forward, Vector3.up));
            var projectile = shot.GetComponent<AdventureProjectile>();
            if (projectile)
            {
                projectile.damage = ultimate ? strongDamage * 1.25f : attackDamage;
                projectile.speed = ultimate ? 15f : 10f;
                projectile.owner = transform;
            }
        }

        void TryAreaPulse(float damage, float radius)
        {
            var hits = Physics.OverlapSphere(transform.position, radius, ~0, QueryTriggerInteraction.Ignore);
            foreach (var hit in hits)
            {
                var creature = hit.GetComponentInParent<CreatureWanderer>();
                if (creature) creature.TakeDamage(damage, transform);
            }
            SpawnImpact(transform.position + Vector3.up * 0.18f, new Color(0.65f, 0.35f, 1f), radius);
        }

        void SpawnImpact(Vector3 position, Color color, float size)
        {
            var fx = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            fx.name = "HitFx";
            fx.transform.position = position;
            fx.transform.localScale = Vector3.one * size;
            var renderer = fx.GetComponent<Renderer>();
            renderer.sharedMaterial = new Material(Shader.Find("Standard")) { color = color };
            Destroy(fx.GetComponent<Collider>());
            Destroy(fx, 0.22f);
        }

        public void TakeDamage(float amount)
        {
            if (blocking) amount *= 0.42f;
            health = Mathf.Max(0f, health - amount);
        }

        void UpdateAnimator()
        {
            if (!animator) return;
            var horizontalSpeed = new Vector3(controller.velocity.x, 0f, controller.velocity.z).magnitude;
            animator.SetFloat("Speed", horizontalSpeed);
            animator.SetBool("Blocking", blocking);
        }
    }
}
