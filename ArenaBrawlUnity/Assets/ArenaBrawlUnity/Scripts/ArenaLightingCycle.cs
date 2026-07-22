using UnityEngine;

namespace ArenaBrawl.UnityGame
{
    public sealed class ArenaLightingCycle : MonoBehaviour
    {
        [SerializeField] private Light sun;
        [SerializeField] private float cycleDurationSeconds = 360f;
        [SerializeField] private Gradient sunColor = new Gradient();
        [SerializeField] private AnimationCurve sunIntensity = AnimationCurve.EaseInOut(0f, 0.2f, 1f, 1.2f);
        [SerializeField] private Color dayFog = new Color(0.62f, 0.79f, 0.9f, 1f);
        [SerializeField] private Color nightFog = new Color(0.04f, 0.06f, 0.1f, 1f);

        private float timeOfDay = 0.28f;

        public float NormalizedTime => timeOfDay;
        public bool IsNight => Mathf.Abs(timeOfDay - 0.5f) < 0.24f;

        private void Reset()
        {
            sun = GetComponent<Light>();
            ConfigureDefaultGradient();
        }

        private void Awake()
        {
            if (sun == null)
            {
                sun = GetComponent<Light>();
            }

            if (sunColor.colorKeys.Length == 0)
            {
                ConfigureDefaultGradient();
            }
        }

        private void Update()
        {
            if (cycleDurationSeconds <= 0.1f || sun == null)
            {
                return;
            }

            timeOfDay = Mathf.Repeat(timeOfDay + Time.deltaTime / cycleDurationSeconds, 1f);
            ApplyLighting(timeOfDay);
        }

        public void ApplyLighting(float normalizedTime)
        {
            var sunAngle = Mathf.Lerp(-35f, 325f, normalizedTime);
            sun.transform.rotation = Quaternion.Euler(sunAngle, -35f, 0f);
            sun.color = sunColor.Evaluate(normalizedTime);
            sun.intensity = Mathf.Max(0.08f, sunIntensity.Evaluate(normalizedTime));

            var nightBlend = Mathf.Clamp01(Mathf.Abs(normalizedTime - 0.5f) * 2f);
            RenderSettings.fogColor = Color.Lerp(nightFog, dayFog, nightBlend);
            RenderSettings.ambientLight = Color.Lerp(new Color(0.05f, 0.06f, 0.09f), new Color(0.47f, 0.55f, 0.64f), nightBlend);
        }

        private void ConfigureDefaultGradient()
        {
            sunColor = new Gradient
            {
                colorKeys = new[]
                {
                    new GradientColorKey(new Color(0.3f, 0.36f, 0.58f), 0f),
                    new GradientColorKey(new Color(1f, 0.62f, 0.32f), 0.22f),
                    new GradientColorKey(new Color(1f, 0.94f, 0.74f), 0.5f),
                    new GradientColorKey(new Color(1f, 0.5f, 0.3f), 0.78f),
                    new GradientColorKey(new Color(0.25f, 0.29f, 0.48f), 1f)
                },
                alphaKeys = new[]
                {
                    new GradientAlphaKey(1f, 0f),
                    new GradientAlphaKey(1f, 1f)
                }
            };
        }
    }
}
