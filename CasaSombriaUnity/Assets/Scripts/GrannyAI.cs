using UnityEngine;
using UnityEngine.AI;

[RequireComponent(typeof(NavMeshAgent))]
public class GrannyAI : MonoBehaviour
{
    public FirstPersonPlayer player;
    public Animator animator;
    public Vector3[] patrolPoints;
    public float viewDistance = 9f;
    public float catchDistance = 1.25f;

    private NavMeshAgent agent;
    private int patrolIndex;
    private Vector3 spawnPosition;
    private Quaternion spawnRotation;
    private Vector3 investigatePosition;
    private float investigateTimer;
    private float repathTimer;
    private State state;

    private enum State
    {
        Patrol,
        Investigate,
        Chase
    }

    private void Awake()
    {
        agent = GetComponent<NavMeshAgent>();
        spawnPosition = transform.position;
        spawnRotation = transform.rotation;
    }

    private void OnEnable()
    {
        HorrorGameManager.NoiseEmitted += HearNoise;
    }

    private void OnDisable()
    {
        HorrorGameManager.NoiseEmitted -= HearNoise;
    }

    private void Start()
    {
        NavMeshHit hit;
        if (!agent.isOnNavMesh && NavMesh.SamplePosition(transform.position, out hit, 3.5f, NavMesh.AllAreas))
        {
            agent.Warp(hit.position);
            spawnPosition = hit.position;
        }
        SetState(State.Patrol);
        GoToPatrolPoint();
    }

    private void Update()
    {
        if (HorrorGameManager.Instance == null || !HorrorGameManager.Instance.IsPlaying || player == null)
        {
            if (agent.enabled) agent.isStopped = true;
            return;
        }

        agent.isStopped = false;
        bool seesPlayer = CanSeePlayer();
        if (seesPlayer) SetState(State.Chase);
        else if (state == State.Chase && (player.IsHidden || Vector3.Distance(transform.position, player.transform.position) > viewDistance * 1.5f))
        {
            investigatePosition = player.transform.position;
            investigateTimer = 5f;
            SetState(State.Investigate);
        }

        if (state == State.Chase)
        {
            repathTimer -= Time.deltaTime;
            if (repathTimer <= 0f)
            {
                repathTimer = 0.16f;
                SetDestination(player.transform.position);
            }

            if (!player.IsHidden && Vector3.Distance(transform.position, player.transform.position) <= catchDistance)
            {
                HorrorGameManager.Instance.CapturePlayer();
            }
        }
        else if (state == State.Investigate)
        {
            investigateTimer -= Time.deltaTime;
            SetDestination(investigatePosition);
            if (investigateTimer <= 0f || ReachedDestination())
            {
                SetState(State.Patrol);
                GoToPatrolPoint();
            }
        }
        else if (ReachedDestination())
        {
            patrolIndex = (patrolIndex + 1) % patrolPoints.Length;
            GoToPatrolPoint();
        }
    }

    private bool CanSeePlayer()
    {
        if (player.IsHidden) return false;
        Vector3 target = player.EyePosition;
        Vector3 origin = transform.position + Vector3.up * 1.55f;
        Vector3 toPlayer = target - origin;
        if (toPlayer.magnitude > viewDistance) return false;
        if (Vector3.Angle(transform.forward, toPlayer) > 58f && toPlayer.magnitude > 2.2f) return false;

        RaycastHit hit;
        if (Physics.Raycast(origin, toPlayer.normalized, out hit, toPlayer.magnitude + 0.25f, ~0, QueryTriggerInteraction.Ignore))
        {
            return hit.collider.GetComponentInParent<FirstPersonPlayer>() != null;
        }
        return false;
    }

    private void HearNoise(Vector3 position, float radius)
    {
        if (Vector3.Distance(transform.position, position) > radius || state == State.Chase) return;
        investigatePosition = position;
        investigateTimer = Mathf.Clamp(radius * 0.45f, 2.5f, 8f);
        SetState(State.Investigate);
    }

    private void SetState(State next)
    {
        if (state == next) return;
        state = next;
        agent.speed = state == State.Chase ? 4.15f : state == State.Investigate ? 2.7f : 1.55f;
        agent.acceleration = state == State.Chase ? 15f : 8f;
        HorrorGameManager.Instance.SetChase(state == State.Chase);

        if (animator != null)
        {
            animator.speed = state == State.Chase ? 1.25f : 0.82f;
            animator.Play(state == State.Chase ? "Run" : "Walk", 0, 0f);
        }
    }

    private void SetDestination(Vector3 destination)
    {
        if (agent.enabled && agent.isOnNavMesh) agent.SetDestination(destination);
    }

    private bool ReachedDestination()
    {
        return agent.enabled && agent.isOnNavMesh && !agent.pathPending && agent.remainingDistance <= agent.stoppingDistance + 0.2f;
    }

    private void GoToPatrolPoint()
    {
        if (patrolPoints == null || patrolPoints.Length == 0) return;
        SetDestination(patrolPoints[patrolIndex]);
    }

    public void ResetEnemy()
    {
        patrolIndex = 0;
        state = State.Patrol;
        if (agent.enabled && agent.isOnNavMesh) agent.Warp(spawnPosition);
        else transform.position = spawnPosition;
        transform.rotation = spawnRotation;
        SetState(State.Investigate);
        SetState(State.Patrol);
        GoToPatrolPoint();
    }
}
