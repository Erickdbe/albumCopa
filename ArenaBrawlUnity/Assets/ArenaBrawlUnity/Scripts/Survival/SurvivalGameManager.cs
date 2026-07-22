using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class SurvivalGameManager : MonoBehaviour
    {
        [SerializeField] private ArenaLightingCycle lightingCycle;
        [SerializeField] private Transform player;
        [SerializeField] private float nightAggressionMultiplier = 1.65f;

        public static SurvivalGameManager Instance { get; private set; }

        public Transform Player => player;
        public float NormalizedTime => lightingCycle != null ? lightingCycle.NormalizedTime : Mathf.Repeat(Time.time / 360f, 1f);
        public bool IsNight => lightingCycle != null ? lightingCycle.IsNight : Mathf.Abs(NormalizedTime - 0.5f) < 0.24f;
        public float ThreatAggressionMultiplier => IsNight ? nightAggressionMultiplier : 1f;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;

            if (lightingCycle == null)
            {
                lightingCycle = FindObjectOfType<ArenaLightingCycle>();
            }

            if (player == null)
            {
                var interactor = FindObjectOfType<SurvivalPlayerInteractor>();
                if (interactor != null)
                {
                    player = interactor.transform;
                }
            }
        }
    }
}
